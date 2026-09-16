import * as path from "node:path";
import { Character } from "../model/character";
import { PALETTE, STATUS_COLOR, mix } from "../render/palette";
import { Screen, truncate } from "../render/screen";

export interface RosterView {
  /** First and last text rows the roster may use. */
  topRow: number;
  bottomRow: number;
  characters: Character[];
  selectedId: string | null;
  scroll: number;
}

export interface RosterHit {
  id: string;
  row: number;
}

/**
 * A plain table of the same agents the office shows. Faster to read when there
 * are more sessions than desks, and it is where the full cwd fits.
 */
export function renderRoster(screen: Screen, view: RosterView): RosterHit[] {
  const { topRow, bottomRow } = view;
  for (let row = topRow; row <= bottomRow; row++) {
    screen.fillTextRow(row, PALETTE.text, row === topRow ? PALETTE.panel : PALETTE.panelAlt);
  }

  const statusW = 9;
  const agentW = 8;
  const wsW = 5;
  const gaugeW = 9;
  const gap = 1;
  const fixed = statusW + agentW + wsW + gaugeW + gap * 5 + 2;
  const nameW = Math.max(10, Math.floor((screen.cols - fixed) * 0.55));
  const cwdW = Math.max(0, screen.cols - fixed - nameW);

  let col = 1;
  const header = (text: string, width: number) => {
    screen.putText(col, topRow, truncate(text, width), PALETTE.textDim, PALETTE.panel);
    col += width + gap;
  };
  header("STATUS", statusW);
  header("NAME", nameW);
  header("AGENT", agentW);
  header("WS", wsW);
  header("CTX/USE", gaugeW);
  if (cwdW > 3) header("PROJECT", cwdW);

  const hits: RosterHit[] = [];
  const visible = bottomRow - topRow;
  if (visible <= 0) return hits;

  const sorted = sortCharacters(view.characters);
  const start = Math.max(0, Math.min(view.scroll, Math.max(0, sorted.length - visible)));

  for (let i = 0; i < visible; i++) {
    const character = sorted[start + i];
    if (!character) break;
    const row = topRow + 1 + i;
    if (row > bottomRow) break;

    const selected = character.id === view.selectedId;
    const bg = selected ? mix(PALETTE.panelAlt, PALETTE.accent, 0.22) : PALETTE.panelAlt;
    screen.fillTextRow(row, PALETTE.text, bg);

    const status = character.snapshot.status;
    const statusColor = STATUS_COLOR[status] ?? PALETTE.textDim;

    let c = 1;
    screen.putText(c, row, truncate(`● ${status}`, statusW), statusColor, bg);
    c += statusW + gap;
    screen.putText(c, row, truncate(character.displayName, nameW), selected ? PALETTE.textBright : PALETTE.text, bg);
    c += nameW + gap;
    screen.putText(c, row, truncate(character.snapshot.agent ?? "-", agentW), PALETTE.textDim, bg);
    c += agentW + gap;
    screen.putText(c, row, truncate(character.snapshot.workspaceId, wsW), PALETTE.textDim, bg);
    c += wsW + gap;
    const { contextPct, usagePct } = character.activity;
    const gauge =
      contextPct === null && usagePct === null
        ? "-"
        : `${pct(contextPct)}/${pct(usagePct)}`;
    screen.putText(c, row, truncate(gauge, gaugeW), gaugeColor(contextPct), bg);
    c += gaugeW + gap;
    if (cwdW > 3) {
      const cwd = character.snapshot.cwd ? path.basename(character.snapshot.cwd) : "-";
      screen.putText(c, row, truncate(cwd, cwdW), PALETTE.textDim, bg);
    }

    hits.push({ id: character.id, row });
  }

  return hits;
}

function pct(value: number | null): string {
  return value === null ? "--" : `${value}%`;
}

function gaugeColor(contextPct: number | null): number {
  if (contextPct === null) return PALETTE.textDim;
  if (contextPct >= 85) return PALETTE.gaugeHigh;
  if (contextPct >= 60) return PALETTE.gaugeMid;
  return PALETTE.gaugeLow;
}

/** Blocked agents first: they are the ones actually waiting on you. */
export function sortCharacters(characters: Character[]): Character[] {
  const rank: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };
  return [...characters].sort((a, b) => {
    const byStatus = (rank[a.snapshot.status] ?? 9) - (rank[b.snapshot.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return a.displayName.localeCompare(b.displayName);
  });
}
