import { PALETTE, STATUS_COLOR } from "../render/palette";
import { Screen, truncate } from "../render/screen";

export type Tab = "office" | "roster" | "settings";

export const TABS: { id: Tab; label: string }[] = [
  { id: "office", label: "Office" },
  { id: "roster", label: "Roster" },
  { id: "settings", label: "Settings" },
];

export interface TabHit {
  id: Tab;
  col0: number;
  col1: number;
}

/** Draws the tab bar on row 0 and returns the clickable spans. */
export function renderTabs(
  screen: Screen,
  active: Tab,
  connected: boolean,
  demo: boolean,
): TabHit[] {
  screen.fillTextRow(0, PALETTE.text, PALETTE.panelAlt);

  const hits: TabHit[] = [];
  let col = 1;
  for (const tab of TABS) {
    const label = ` ${tab.label} `;
    const isActive = tab.id === active;
    screen.putText(
      col,
      0,
      label,
      isActive ? PALETTE.textBright : PALETTE.textDim,
      isActive ? PALETTE.panel : PALETTE.panelAlt,
    );
    hits.push({ id: tab.id, col0: col, col1: col + label.length });
    col += label.length + 1;
  }

  const badge = demo ? "demo" : connected ? "live" : "offline";
  const badgeColor = demo ? STATUS_COLOR.blocked : connected ? STATUS_COLOR.working : STATUS_COLOR.unknown;
  const text = `● ${badge}`;
  screen.putText(Math.max(col, screen.cols - text.length - 1), 0, text, badgeColor, PALETTE.panelAlt);

  return hits;
}

export interface StatusCounts {
  total: number;
  working: number;
  blocked: number;
  done: number;
  idle: number;
}

/** Draws the bottom status bar: counts on the left, key hints on the right. */
export function renderStatusBar(
  screen: Screen,
  counts: StatusCounts,
  hints: string,
  message: string | null,
): void {
  const row = screen.rows - 1;
  screen.fillTextRow(row, PALETTE.text, PALETTE.panelAlt);

  if (message) {
    screen.putText(1, row, truncate(message, screen.cols - 2), STATUS_COLOR.blocked, PALETTE.panelAlt);
    return;
  }

  let col = 1;
  const plural = counts.total === 1 ? "agent" : "agents";
  const head = `${counts.total} ${plural}`;
  screen.putText(col, row, head, PALETTE.text, PALETTE.panelAlt);
  col += head.length;

  const parts: [string, number, number][] = [
    ["working", counts.working, STATUS_COLOR.working],
    ["blocked", counts.blocked, STATUS_COLOR.blocked],
    ["done", counts.done, STATUS_COLOR.done],
    ["idle", counts.idle, STATUS_COLOR.idle],
  ];
  for (const [label, count, color] of parts) {
    if (count === 0) continue;
    const text = ` · ${count} ${label}`;
    if (col + text.length >= screen.cols - 2) break;
    screen.putText(col, row, text, color, PALETTE.panelAlt);
    col += text.length;
  }

  const hintCol = screen.cols - hints.length - 1;
  if (hintCol > col + 1) {
    screen.putText(hintCol, row, hints, PALETTE.textDim, PALETTE.panelAlt);
  }
}
