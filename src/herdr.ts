import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

const KNOWN_STATUSES: AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

export interface AgentSnapshot {
  paneId: string;
  terminalId: string;
  workspaceId: string;
  tabId: string;
  /** The CLI behind the session, as herdr reports it. */
  agent: string | null;
  /** Explicit agent name when one was set; teammates have one, plain sessions do not. */
  name: string | null;
  /** Human label for the character: name, else the stripped terminal title. */
  label: string;
  status: AgentStatus;
  cwd: string | null;
  focused: boolean;
}

/**
 * Finds the herdr API socket the way herdr itself resolves it: the env var a
 * plugin pane inherits, then the default session path, then asking the CLI.
 */
export function discoverSocket(): string | null {
  const fromEnv = process.env.HERDR_SOCKET_PATH;
  if (fromEnv && exists(fromEnv)) return fromEnv;

  const configHome = process.env.HERDR_HOME
    ? path.join(process.env.HERDR_HOME)
    : path.join(os.homedir(), ".config", "herdr");
  const defaultPath = path.join(configHome, "herdr.sock");
  if (exists(defaultPath)) return defaultPath;

  try {
    const raw = execFileSync("herdr", ["status", "server", "--json"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(raw) as { socket?: string; running?: boolean };
    if (parsed.running && parsed.socket && exists(parsed.socket)) return parsed.socket;
  } catch {
    // herdr not on PATH, or no server running - caller falls back to demo mode.
  }
  return null;
}

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isSocket();
  } catch {
    return false;
  }
}

/**
 * One request, one connection. herdr speaks newline-delimited JSON and answers
 * a request with a single response line, so this stays simple and stateless.
 */
export function request(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 3000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const finish = (err: Error | null, value?: any) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`${method}: timed out`)));
    socket.on("error", (err) => finish(err));

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: `pixel-${method}`, method, params })}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const parsed = JSON.parse(buffer.slice(0, newline));
        if (parsed.error) {
          finish(new Error(parsed.error.message ?? String(parsed.error)));
          return;
        }
        finish(null, parsed.result);
      } catch (err) {
        finish(err as Error);
      }
    });

    socket.on("close", () => finish(new Error(`${method}: connection closed`)));
  });
}

export async function listAgents(socketPath: string): Promise<AgentSnapshot[]> {
  const result = await request(socketPath, "agent.list");
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  return agents.map(toSnapshot).filter((a: AgentSnapshot | null): a is AgentSnapshot => a !== null);
}

/** Brings the agent's terminal to the front. `target` accepts a pane id. */
export async function focusAgent(socketPath: string, paneId: string): Promise<void> {
  await request(socketPath, "agent.focus", { target: paneId });
}

function toSnapshot(raw: any): AgentSnapshot | null {
  if (!raw || typeof raw.pane_id !== "string") return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  const title =
    (typeof raw.terminal_title_stripped === "string" && raw.terminal_title_stripped.trim()) ||
    (typeof raw.title === "string" && raw.title.trim()) ||
    (typeof raw.terminal_title === "string" && raw.terminal_title.trim()) ||
    "";
  const agent =
    (typeof raw.display_agent === "string" && raw.display_agent) ||
    (typeof raw.agent === "string" && raw.agent) ||
    null;

  const status: AgentStatus = KNOWN_STATUSES.includes(raw.agent_status)
    ? raw.agent_status
    : "unknown";

  return {
    paneId: raw.pane_id,
    terminalId: typeof raw.terminal_id === "string" ? raw.terminal_id : raw.pane_id,
    workspaceId: typeof raw.workspace_id === "string" ? raw.workspace_id : "?",
    tabId: typeof raw.tab_id === "string" ? raw.tab_id : "?",
    agent,
    name,
    label: name ?? title ?? "",
    status,
    cwd: typeof raw.cwd === "string" ? raw.cwd : null,
    focused: raw.focused === true,
  };
}

/** Visible pane text, used to derive what the agent is actually doing. */
export async function readPane(
  socketPath: string,
  paneId: string,
  lines = 30,
): Promise<string> {
  const result = await request(socketPath, "agent.read", {
    target: paneId,
    source: "visible",
    lines,
    strip_ansi: true,
  });
  const text = result?.read?.text;
  return typeof text === "string" ? text : "";
}

export interface PollHandle {
  stop(): void;
}

/**
 * Polls `agent.list` on an interval. herdr's event subscriptions are per-pane,
 * which would mean re-subscribing every time a pane appears; for a view that
 * only repaints at ~12fps a cheap poll is both simpler and always complete.
 */
/**
 * Reads one pane per tick, round-robin over the current agents. Pane reads are
 * far heavier than `agent.list`, so this bounds the rate rather than fanning out
 * across every agent at once; with a 250ms tick a 20-agent office refreshes each
 * character's activity every ~5s, and the working ones are visited first.
 */
export function pollActivity(
  socketPath: string,
  intervalMs: number,
  nextTarget: () => string | null,
  onPane: (paneId: string, text: string) => void,
): PollHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    const target = nextTarget();
    if (target) {
      try {
        const text = await readPane(socketPath, target);
        if (!stopped) onPane(target, text);
      } catch {
        // A pane can close between listing and reading; skip it this round.
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function pollAgents(
  socketPath: string,
  intervalMs: number,
  onAgents: (agents: AgentSnapshot[]) => void,
  onError: (err: Error) => void,
): PollHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const agents = await listAgents(socketPath);
      if (!stopped) onAgents(agents);
    } catch (err) {
      if (!stopped) onError(err as Error);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
