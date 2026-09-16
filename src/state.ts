import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Small amount of state worth surviving a restart: which desk each agent had,
 * and the display preferences. The active screen is deliberately NOT among
 * them — the office always opens on the office. herdr hands plugins a state directory; fall back
 * to the usual per-user location when running outside a pane.
 */
export interface PersistedState {
  desks: Record<string, number>;
  lounge: Record<string, number>;
  showNames: boolean;
  sound: boolean;
  chatter: boolean;
  showClock: boolean;
  companyName: string;
  reminderOn: boolean;
}

function stateDir(): string {
  const fromHerdr = process.env.HERDR_PLUGIN_STATE_DIR;
  if (fromHerdr) return fromHerdr;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "herdr-pixel-office");
  }
  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "herdr-pixel-office",
  );
}

function stateFile(): string {
  return path.join(stateDir(), "office.json");
}

export function loadState(): Partial<PersistedState> {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

export function saveState(state: PersistedState): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Losing the layout is not worth taking the office down for.
  }
}
