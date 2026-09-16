import { App } from "./app";
import { discoverSocket, pollActivity, pollAgents, PollHandle } from "./herdr";
import { MockHerdr } from "./mock";
import { Screen } from "./render/screen";

const FRAME_MS = 1000 / 12;
const POLL_MS = 1000;
/** One pane read per tick, round-robin: heavier than agent.list, so rate-bound it. */
const ACTIVITY_MS = 250;
const DEMO_POLL_MS = 500;

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DISABLE_WRAP = "\x1b[?7l";
const ENABLE_WRAP = "\x1b[?7h";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
const RESET_SGR = "\x1b[0m";

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const out = process.stdout;
  if (!out.isTTY) {
    process.stderr.write("pixel-agents: needs a TTY (run it as a herdr pane or in a terminal)\n");
    process.exitCode = 1;
    return;
  }

  const forceDemo = argv.includes("--demo");
  const socketPath = forceDemo ? null : discoverSocket();
  const demo = forceDemo || socketPath === null;

  const screen = new Screen();
  const app = new App(screen, { socketPath, demo });

  const resize = () => {
    // A pty whose size has not been negotiated yet reports 0, which `??` would
    // happily accept - fall back on any non-positive size, not just undefined.
    const cols = out.columns > 0 ? out.columns : 80;
    const rows = out.rows > 0 ? out.rows : 24;
    screen.resize(cols, rows);
    app.onResize();
  };
  resize();

  out.write(ENTER_ALT + HIDE_CURSOR + DISABLE_WRAP + ENABLE_MOUSE);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    app.persist();
    poller?.stop();
    activityPoller?.stop();
    clearInterval(frameTimer);
    if (mockTimer) clearInterval(mockTimer);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    out.write(RESET_SGR + DISABLE_MOUSE + ENABLE_WRAP + SHOW_CURSOR + LEAVE_ALT);
  };

  const quit = (code = 0) => {
    cleanup();
    process.exit(code);
  };

  /* Agent source: the live socket, or the demo farm. */
  let poller: PollHandle | null = null;
  let activityPoller: PollHandle | null = null;
  let mockTimer: NodeJS.Timeout | null = null;

  if (demo) {
    const mock = new MockHerdr();
    app.syncAgents(mock.agents());
    mockTimer = setInterval(() => app.syncAgents(mock.agents()), DEMO_POLL_MS);
  } else if (socketPath) {
    poller = pollAgents(
      socketPath,
      POLL_MS,
      (agents) => app.syncAgents(agents),
      (err) => app.setDisconnected(err),
    );
    activityPoller = pollActivity(
      socketPath,
      ACTIVITY_MS,
      () => app.nextActivityTarget(),
      (paneId, text) => app.applyPaneText(paneId, text),
    );
  }

  /* Input. */
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    for (const event of decodeInput(chunk.toString("utf8"))) {
      if (event.kind === "key") {
        if (!app.handleKey(event.key)) {
          quit(0);
          return;
        }
      } else if (event.kind === "click") {
        app.handleClick(event.col, event.row);
      } else if (event.kind === "drag") {
        app.handleDrag(event.col, event.row);
      } else if (event.kind === "release") {
        app.handleRelease(event.col, event.row);
      } else if (event.kind === "hover") {
        app.handleHover(event.col, event.row);
      } else {
        app.scrollBy(event.delta);
      }
    }
  });

  out.on("resize", resize);
  process.on("SIGINT", () => quit(0));
  process.on("SIGTERM", () => quit(0));
  process.on("exit", cleanup);

  /* Render loop. */
  const frameTimer = setInterval(() => {
    app.tick();
    app.render();
    const frame = screen.frame();
    if (frame) out.write(frame);
  }, FRAME_MS);
}

function printHelp(): void {
  process.stdout.write(
    [
      "pixel-agents — your herdr agents as pixel-art characters in an office",
      "",
      "Usage: node dist/main.js [--demo]",
      "",
      "  --demo    Run with mock agents, ignoring any live herdr server",
      "  --help    Show this message",
      "",
      "Keys: tab switch screens · n names · ↑↓←→ select · enter focus · q quit",
      "",
    ].join("\n"),
  );
}

type InputEvent =
  | { kind: "key"; key: string }
  | { kind: "click"; col: number; row: number }
  | { kind: "drag"; col: number; row: number }
  | { kind: "release"; col: number; row: number }
  | { kind: "hover"; col: number; row: number }
  | { kind: "scroll"; delta: number };

const ARROWS: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
/** CSI n~ sequences: 5 = PageUp, 6 = PageDown, 1/7 = Home, 4/8 = End. */
const TILDE_KEYS: Record<string, string> = {
  "5": "pageup",
  "6": "pagedown",
  "1": "home",
  "7": "home",
  "4": "end",
  "8": "end",
};
const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

/** Decodes a raw stdin chunk into key presses and SGR mouse events. */
export function decodeInput(data: string): InputEvent[] {
  const events: InputEvent[] = [];
  let i = 0;

  while (i < data.length) {
    const rest = data.slice(i);

    const mouse = SGR_MOUSE.exec(rest);
    if (mouse) {
      const button = Number(mouse[1]);
      const col = Number(mouse[2]) - 1;
      const row = Number(mouse[3]) - 1;
      const isRelease = mouse[4] === "m";

      // SGR button field: bit 6 = wheel, bit 5 = motion, low 2 bits = button.
      if (button & 64) {
        events.push({ kind: "scroll", delta: button & 1 ? 4 : -4 });
      } else if (button & 32) {
        const held = button & 0b11;
        if (held === 0b11) events.push({ kind: "hover", col, row });
        else if (held === 0) events.push({ kind: "drag", col, row });
      } else if (isRelease) {
        events.push({ kind: "release", col, row });
      } else if ((button & 0b11) === 0) {
        events.push({ kind: "click", col, row });
      }

      i += mouse[0].length;
      continue;
    }

    if (rest.startsWith("\x1b[")) {
      const arrow = ARROWS[rest[2]];
      if (arrow) {
        events.push({ kind: "key", key: arrow });
        i += 3;
        continue;
      }
      // CSI n~ : page and home/end keys.
      const tilde = /^\x1b\[(\d+)~/.exec(rest);
      if (tilde) {
        const key = TILDE_KEYS[tilde[1]];
        if (key) events.push({ kind: "key", key });
        i += tilde[0].length;
        continue;
      }
      // Unknown CSI sequence: skip to its final byte so it is not typed through.
      let j = 2;
      while (j < rest.length && !/[A-Za-z~]/.test(rest[j])) j++;
      i += Math.min(rest.length, j + 1);
      continue;
    }

    events.push({ kind: "key", key: data[i] });
    i += 1;
  }

  return events;
}

if (require.main === module) main();
