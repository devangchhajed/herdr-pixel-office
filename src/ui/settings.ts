import { PALETTE, STATUS_COLOR } from "../render/palette";
import { Screen, truncate } from "../render/screen";

export interface SettingsView {
  topRow: number;
  bottomRow: number;
  companyName: string;
  /** Live buffer while the name is being edited, or null when it is not. */
  editing: string | null;
  showNames: boolean;
  chatter: boolean;
  sound: boolean;
  showClock: boolean;
  reminderOn: boolean;
}

interface Row {
  label: string;
  value: string;
  key: string;
  on?: boolean;
}

/**
 * A plain settings list. The company name is the only editable field; the rest
 * mirror the keyboard toggles so they are discoverable rather than folklore.
 */
/** Where values start; labels run from column 2 up to just before it. */
const VALUE_COL = 24;
/** Where the shortcut key sits. Wide enough for the longest value ("hourly"). */
const KEY_COL = VALUE_COL + 8;

export function renderSettings(screen: Screen, view: SettingsView): void {
  for (let row = view.topRow; row <= view.bottomRow; row++) {
    screen.fillTextRow(row, PALETTE.text, PALETTE.panelAlt);
  }

  let row = view.topRow + 1;
  screen.putText(2, row, "SETTINGS", PALETTE.textBright, PALETTE.panelAlt);
  row += 2;

  const editing = view.editing !== null;
  const shown = editing ? view.editing ?? "" : view.companyName;
  const field = shown || (editing ? "" : "(not set)");
  const width = Math.max(18, Math.min(32, screen.cols - 24));

  screen.putText(2, row, "Company name", PALETTE.text, PALETTE.panelAlt);
  // A visible box, so it reads as a field rather than a label.
  screen.putText(
    VALUE_COL,
    row,
    `[ ${truncate(field, width - 4).padEnd(width - 4)} ]`,
    editing ? PALETTE.textBright : shown ? PALETTE.text : PALETTE.textDim,
    editing ? PALETTE.panel : PALETTE.panelAlt,
  );
  if (editing) {
    // Block cursor at the end of the buffer.
    const caret = VALUE_COL + 2 + Math.min(shown.length, width - 5);
    screen.putText(caret, row, "▏", PALETTE.accent, PALETTE.panel);
  }
  screen.putText(
    VALUE_COL + 2 + width,
    row,
    editing ? "enter save · esc cancel" : "enter to edit",
    PALETTE.textDim,
    PALETTE.panelAlt,
  );
  row += 2;

  const toggles: Row[] = [
    { label: "Name tags", value: view.showNames ? "on" : "off", key: "n", on: view.showNames },
    { label: "Break-room chatter", value: view.chatter ? "on" : "off", key: "t", on: view.chatter },
    { label: "Bell when blocked", value: view.sound ? "on" : "off", key: "s", on: view.sound },
    { label: "Wall clock", value: view.showClock ? "on" : "off", key: "c", on: view.showClock },
    {
      label: "Water reminder",
      value: view.reminderOn ? "hourly" : "off",
      key: "r",
      on: view.reminderOn,
    },
  ];
  for (const toggle of toggles) {
    if (row > view.bottomRow) break;
    // "Break-room chatter" is 18 characters; a value column at 18 cut it off.
    screen.putText(2, row, truncate(toggle.label, VALUE_COL - 3), PALETTE.text, PALETTE.panelAlt);
    screen.putText(
      VALUE_COL,
      row,
      toggle.value,
      toggle.on ? STATUS_COLOR.working : PALETTE.textDim,
      PALETTE.panelAlt,
    );
    screen.putText(KEY_COL, row, toggle.key, PALETTE.textDim, PALETTE.panelAlt);
    row += 1;
  }
}
