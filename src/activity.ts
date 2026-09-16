import * as path from "node:path";

/**
 * Derives what an agent is *doing* from its pane text.
 *
 * herdr's `agent.list` only reports a coarse status (idle/working/blocked/...),
 * so the tool-level detail that drives the reading-vs-typing animation, the
 * activity label and the health bars is scraped from `agent.read`. herdr detects
 * its own status the same way; the blocked-kind patterns below are lifted from
 * the rules it exposes via `agent.explain`.
 */

/** Tools that show the reading animation. Mirrors the pixel-agents provider. */
const READING_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
/** Tools that spawn a sub-agent character. */
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

const BASH_LABEL_MAX = 24;
const TASK_LABEL_MAX = 24;

export type ToolKind = "reading" | "typing";
export type BlockedKind = "permission" | "input";

export interface Activity {
  /** Tool name of the most recent tool call, e.g. "Bash". */
  tool: string | null;
  /** Human label for the character, e.g. "Reading office.ts". */
  label: string | null;
  kind: ToolKind;
  /** Live spinner detail while working, e.g. "30s · ↓ 821 tokens". */
  detail: string | null;
  /** Percent of the context window used, 0..100. */
  contextPct: number | null;
  /** Percent of the rate-limit window used, 0..100. */
  usagePct: number | null;
  /** Why the agent is blocked, when it is. */
  blockedKind: BlockedKind | null;
  /** Sub-agents this agent appears to be running right now. */
  subagents: number;
}

export function emptyActivity(): Activity {
  return {
    tool: null,
    label: null,
    kind: "typing",
    detail: null,
    contextPct: null,
    usagePct: null,
    blockedKind: null,
    subagents: 0,
  };
}

/**
 * `✻ Waiting for 3 background agents to finish` — the authoritative count of
 * live sub-agents. Taken from herdr's own `background_agents_working` rule;
 * counting `Task(` calls in the pane would also count finished ones.
 */
const BACKGROUND_AGENTS = /Waiting for (\d+) background agents? to finish/;

/** `⏺ Bash(npm test)` — may appear mid-line when the pane wrapped. */
const TOOL_CALL = /⏺\s+([A-Za-z_][A-Za-z0-9_]*)\(([^\n]*)/g;
/**
 * `Context █████████░ 88%` / `Usage ████░░░░░░ 41%`.
 *
 * The bar glyphs are required, and the LAST match wins. Without both, an agent
 * that merely writes "Context 12%" in its own output hijacks its own gauge —
 * the status line is at the bottom of the pane, the prose is above it.
 */
const CONTEXT_PCT = /Context\s+[█▓▒░]+\s*(\d+)%/g;
const USAGE_PCT = /Usage\s+[█▓▒░]+\s*(\d+)%/g;
/** `✽ Thinking… (30s · ↓ 821 tokens · …)` — present tense means still running. */
const LIVE_SPINNER = /[✻✽✳✢✶✷✺·*]\s+(\p{L}+)…\s*\(([^)]*)\)/u;
/** `✻ Crunched for 5m 39s` — past tense, the turn is over. */
const FINISHED_SPINNER = /[✻✽✳✢✶✷✺·*]\s+(\p{L}+)\s+for\s+([0-9hms\s]+?)\s*$/mu;

export function parseActivity(paneText: string): Activity {
  const result = emptyActivity();
  if (!paneText) return result;

  result.contextPct = lastPercent(CONTEXT_PCT, paneText);
  result.usagePct = lastPercent(USAGE_PCT, paneText);

  // Last tool call wins: that is what the agent is doing (or just did).
  TOOL_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastTool: { name: string; args: string } | null = null;
  while ((match = TOOL_CALL.exec(paneText)) !== null) {
    lastTool = { name: match[1], args: match[2] };
  }

  if (lastTool) {
    result.tool = lastTool.name;
    result.kind = READING_TOOLS.has(lastTool.name) ? "reading" : "typing";
    result.label = formatToolStatus(lastTool.name, lastTool.args);
  }

  const background = BACKGROUND_AGENTS.exec(paneText);
  const live = LIVE_SPINNER.exec(paneText);

  if (background) {
    result.subagents = Number(background[1]);
  } else if (live && lastTool && SUBAGENT_TOOLS.has(lastTool.name)) {
    // A subtask that is still spinning: one sub-agent, not yet reported as a
    // background batch.
    result.subagents = 1;
  }

  if (live) {
    result.detail = tidy(live[2]);
    // The spinner verb is a better label than a stale tool call.
    if (!result.label) result.label = `${live[1]}…`;
  } else {
    const finished = FINISHED_SPINNER.exec(paneText);
    if (finished) result.detail = `${finished[1].toLowerCase()} ${tidy(finished[2])}`;
  }

  result.blockedKind = detectBlockedKind(paneText);
  return result;
}

/**
 * Splits herdr's single `blocked` status the way pixel-agents splits its
 * bubbles: a permission request that stays until you answer, versus any other
 * prompt waiting on input. Patterns come from herdr's own detection rules.
 */
function detectBlockedKind(paneText: string): BlockedKind | null {
  const lower = paneText.toLowerCase();
  if (lower.includes("do you want to proceed?")) return "permission";
  if (lower.includes("requests your input")) return "input";
  if (lower.includes("esc to cancel")) return "input";
  return null;
}

/** Mirrors the pixel-agents provider's `formatToolStatus`. */
export function formatToolStatus(tool: string, rawArgs: string): string {
  const args = tidy(rawArgs.replace(/\)\s*$/, ""));
  const base = (p: string) => (p ? path.basename(p.replace(/["']/g, "")) : "");

  switch (tool) {
    case "Read":
      return `Reading ${base(firstArg(args))}`.trim();
    case "Edit":
    case "MultiEdit":
      return `Editing ${base(firstArg(args))}`.trim();
    case "Write":
      return `Writing ${base(firstArg(args))}`.trim();
    case "NotebookEdit":
      return `Editing ${base(firstArg(args))}`.trim();
    case "Bash":
      return `Running: ${truncate(args, BASH_LABEL_MAX)}`;
    case "Glob":
      return "Searching files";
    case "Grep":
      return "Searching code";
    case "WebFetch":
      return "Fetching web content";
    case "WebSearch":
      return "Searching the web";
    case "Task":
    case "Agent":
      return args ? `Subtask: ${truncate(args, TASK_LABEL_MAX)}` : "Running subtask";
    case "AskUserQuestion":
      return "Waiting for your answer";
    default:
      if (tool.startsWith("mcp__")) {
        const short = tool.split("__").pop() ?? tool;
        return `Calling ${short}`;
      }
      return tool;
  }
}

function firstArg(args: string): string {
  const comma = args.indexOf(",");
  return (comma === -1 ? args : args.slice(0, comma)).trim();
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  const t = tidy(text);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Last match of a global regex whose first group is a percentage. */
function lastPercent(pattern: RegExp, text: string): number | null {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  let value: number | null = null;
  while ((match = pattern.exec(text)) !== null) value = clampPct(Number(match[1]));
  return value;
}

function clampPct(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}
