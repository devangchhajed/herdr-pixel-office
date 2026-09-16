/**
 * Office geometry: one room, two zones.
 *
 * Agents that are doing something sit at a desk in the desk bank. Agents that
 * are not doing anything go to the common area and sit on the sofa or a bench.
 * Furniture is always drawn whether or not anyone is using it — a bank of empty
 * desks is what makes the room read as an office rather than a grid of agents.
 */

export type Zone = "desk" | "lounge";
export type SpotPose = "desk" | "sofa" | "bench" | "stand";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A place a character can be: a desk, a sofa cushion, a spot by the coffee machine. */
export interface Spot {
  id: string;
  zone: Zone;
  pose: SpotPose;
  /** Top-left of the character body at this spot. */
  x: number;
  y: number;
}

/* Desk slot -------------------------------------------------------------- */

export const DESK_SLOT_W = 22;
/**
 * Vertical budget per desk slot: bubble headroom 6, body 10, desk 5, health
 * gauges 2, then two label rows. Desk tags alternate between those two rows by
 * column so a tag can be twice the slot width before it meets its neighbour —
 * at 12 columns a single-row tag truncates to nothing useful. A bubble reaches
 * 5px above the body, so DESK_SLOT_H must be STRICTLY greater than
 * SEAT_LABEL_DY + 2 + 5.
 */
export const DESK_SLOT_H = 30;

/**
 * Every offset is EVEN on purpose. A cell covers 2x2 subpixels, and the sprites
 * are authored so no cell needs more than two colours — but that only holds if
 * the sprite lands on the cell grid. Draw a character at an odd x and every
 * cell straddles two art columns, mixing colours that were never meant to share
 * one, which is exactly what smearing looks like.
 */
export const SEAT_CHAR_DX = 6;
export const SEAT_CHAR_DY = 2;
export const SEAT_CHAIR_DX = 2;
export const SEAT_CHAIR_DY = 4;
export const SEAT_DESK_DX = 2;
export const SEAT_DESK_DY = 10;
export const SEAT_DESK_H = 8;
export const SEAT_MONITOR_DX = 4;
export const SEAT_MONITOR_DY = 10;
/** Two 1px gauges (context, usage) spanning the desk width. */
export const SEAT_BAR_DY = 18;
export const SEAT_LABEL_DY = 20;


/* Room ------------------------------------------------------------------- */

/** Wall without the clock: just enough for paintings and a doorway. */
/**
 * Tall enough for the seven-segment clock and its caption, and no taller.
 * Seven segments need five 2px bands, so the face cannot be shorter than 10
 * subpixels; with the caption row and margins that is 16. Everything else on
 * the wall shares that band rather than stacking below it.
 */
export const WALL_H = 16;

export function wallHeight(): number {
  return WALL_H;
}

/** Top of the header row within the wall. */
export const HEADER_Y = 2;
/** Doorway, which the header must not overlap. */
export const DOOR_X = 3;
export const DOOR_W = 16;
/** First column the header may use, clear of the doorway. */
export const HEADER_X = DOOR_X + DOOR_W + 4;
const MARGIN = 3;
/** Clear band under the wall that characters walk along between zones. */
const CORRIDOR_H = 3;
/** Gap between the desk bank and the break room below it. */
const ZONE_GAP = 4;
/** Space above each packed row so heads and speech bubbles fit. */
const BREAK_HEADROOM = 6;
/** Space below each packed row for people standing on the near side. */
const BREAK_FOOTROOM = 5;
const BREAK_GAP = 4;

export interface DeskSlot {
  index: number;
  /** Top-left of the desk slot. */
  x: number;
  y: number;
}

export type DecorKind = "plant" | "cooler" | "painting" | "clock" | "bookshelf" | "bin";

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
}

/** How many desk columns a pane of this width fits. */
export function deskColumnsFor(pxW: number): number {
  const usable = Math.max(DESK_SLOT_W, Math.max(24, pxW) - MARGIN * 2);
  return Math.max(1, Math.floor(usable / DESK_SLOT_W));
}

/** A named band of desk rows: one herdr workspace's corner of the office. */
export interface OfficeArea {
  label: string;
  color: number;
  /** Desk index range, [deskStart, deskEnd). */
  deskStart: number;
  deskEnd: number;
}

export interface Room {
  width: number;
  /** Height of the back wall, which depends on whether the clock is shown. */
  wallH: number;
  /** Whether the clock plaque is shown. */
  showClock: boolean;
  contentHeight: number;
  deskArea: Rect;
  /** The common area: sofa, coffee, and the games, laid out below the desks. */
  lounge: Rect;
  furniture: BreakRoomFurniture;
  desks: DeskSlot[];
  deskColumns: number;
  decor: Decor[];
  doorY: number;
  corridorY: number;
}

/**
 * Builds the room: a desk bank across the full width, and a break room beneath
 * it. The break room runs full width rather than sitting beside the desks
 * because the games need the horizontal space, and it gives the desk bank the
 * whole width too.
 */
export function layoutRoom(
  pxW: number,
  deskDemand: number,
  loungeDemand: number,
  showClock = true,
): Room {
  const width = Math.max(24, pxW);
  const wallH = wallHeight();
  const corridorY = wallH + 1;
  // Even, so desk slots, chairs and characters all share the cell grid.
  const contentTop = (corridorY + CORRIDOR_H + 1) & ~1;

  const deskAreaW = Math.max(DESK_SLOT_W, width - MARGIN * 2);
  const deskColumns = Math.max(1, Math.floor(deskAreaW / DESK_SLOT_W));

  // Size the desk bank to demand, not to the viewport. Filling the screen with
  // empty desks would push the break room below the fold, which is where all
  // the idle agents are — the half of the office worth watching.
  const rowsNeeded = Math.ceil(Math.max(deskDemand, 1) / deskColumns);
  const deskRows = Math.max(1, rowsNeeded);

  const gridW = deskColumns * DESK_SLOT_W;
  // Even, so every desk slot lands on the cell grid.
  const originX = (MARGIN + Math.max(0, Math.floor((deskAreaW - gridW) / 2))) & ~1;

  const desks: DeskSlot[] = [];
  for (let i = 0; i < deskColumns * deskRows; i++) {
    desks.push({
      index: i,
      x: originX + (i % deskColumns) * DESK_SLOT_W,
      y: contentTop + Math.floor(i / deskColumns) * DESK_SLOT_H,
    });
  }

  const deskArea: Rect = { x: MARGIN, y: contentTop, w: deskAreaW, h: deskRows * DESK_SLOT_H };
  /** Where the last desk row actually stops painting (tag included). */
  const deskInkH = (deskRows - 1) * DESK_SLOT_H + SEAT_LABEL_DY + 3;

  const loungeX = MARGIN;
  const loungeY = (contentTop + deskInkH + ZONE_GAP + 1) & ~1;
  const loungeW = Math.max(DESK_SLOT_W, width - MARGIN * 2);

  const furniture = packBreakRoom(loungeX, loungeY, loungeW);
  // Extra standing room when more agents are idle than the furniture seats.
  const overflowRows = Math.ceil(Math.max(0, loungeDemand - 6) / 3);
  const lounge: Rect = {
    x: loungeX,
    y: loungeY,
    w: loungeW,
    h: furniture.height + overflowRows * 14 + 4,
  };

  return {
    width,
    contentHeight: lounge.y + lounge.h + 4,
    deskArea,
    lounge,
    furniture,
    desks,
    deskColumns,
    wallH,
    showClock,
    decor: buildDecor(width, lounge, wallH),
    doorY: WALL_H - 1,
    corridorY,
  };
}

function buildDecor(width: number, lounge: Rect, wallH: number): Decor[] {
  const decor: Decor[] = [];
  // Nothing hangs on the wall now that it is a single plaque row; floor
  // dressing carries the office character instead.
  decor.push({ kind: "plant", x: 2, y: wallH + 1 });
  decor.push({ kind: "bin", x: lounge.x + lounge.w - 10, y: lounge.y + 2 });
  if (width > 140) decor.push({ kind: "cooler", x: width - 14, y: wallH + 2 });
  return decor;
}

/* Break room ------------------------------------------------------------- */

export interface BreakRoomFurniture {
  rug: Rect;
  sofa: Rect;
  table: Rect;
  coffee: Rect;
  bench: Rect;
  pingPong: Rect;
  pool: Rect;
  foosball: Rect;
  cocktail: Rect;
  dining: Rect;
  sofaSeats: Point[];
  benchSeats: Point[];
  standSpots: Point[];
  /** Where the two table-tennis players stand. */
  pingPongSpots: Point[];
  /** Where the two pool players stand. */
  poolSpots: Point[];
  /** Where the two foosball players stand. */
  foosballSpots: Point[];
  /** Where drinkers stand at the cocktail counter. */
  cocktailSpots: Point[];
  /** Seats around the communal table, for drinks and lunch. */
  diningSeats: Point[];
  /** Where the bartender stands, behind the counter. */
  bartender: Point;
  overflowY: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

interface PackItem {
  key:
    | "sofa"
    | "table"
    | "coffee"
    | "bench"
    | "dining"
    | "pingPong"
    | "pool"
    | "foosball"
    | "cocktail";
  w: number;
  h: number;
}

const BREAK_ITEMS: PackItem[] = [
  { key: "sofa", w: 18, h: 9 },
  { key: "table", w: 12, h: 5 },
  { key: "coffee", w: 8, h: 9 },
  { key: "bench", w: 16, h: 7 },
  { key: "dining", w: 28, h: 12 },
  { key: "pingPong", w: 22, h: 9 },
  { key: "pool", w: 24, h: 11 },
  { key: "foosball", w: 24, h: 11 },
  { key: "cocktail", w: 20, h: 9 },
];

/**
 * Flows the break-room furniture left to right, wrapping when it runs out of
 * width. Every pane gets the same furniture; only the arrangement changes, so
 * narrow panes end up with a taller break room rather than a missing pool table.
 */
function packBreakRoom(x: number, y: number, width: number): BreakRoomFurniture {
  const placed = new Map<PackItem["key"], Rect>();
  // Games need clear floor either side for the players.
  // Games need clear floor either side for the players; the bar only needs it
  // on the near side, which the row footroom already provides.
  const sideRoom = (key: PackItem["key"]) =>
    key === "pingPong" || key === "pool" || key === "foosball" ? 9 : 0;

  let cursorX = (x + 3) & ~1;
  let rowY = (y + BREAK_HEADROOM + 1) & ~1;
  let rowH = 0;

  for (const item of BREAK_ITEMS) {
    const need = item.w + sideRoom(item.key) * 2;
    const fits = cursorX + need <= x + width - 2;
    if (!fits && rowH > 0) {
      rowY = (rowY + rowH + BREAK_FOOTROOM + BREAK_HEADROOM + 1) & ~1;
      cursorX = x + 3;
      rowH = 0;
    }
    const rect: Rect = { x: (cursorX + sideRoom(item.key)) & ~1, y: rowY, w: item.w, h: item.h };
    placed.set(item.key, rect);
    cursorX = (cursorX + need + BREAK_GAP + 1) & ~1;
    rowH = Math.max(rowH, item.h);
  }

  const sofa = placed.get("sofa")!;
  const table = placed.get("table")!;
  const coffee = placed.get("coffee")!;
  const bench = placed.get("bench")!;
  const pingPong = placed.get("pingPong")!;
  const pool = placed.get("pool")!;
  const foosball = placed.get("foosball")!;
  const cocktail = placed.get("cocktail")!;
  const dining = placed.get("dining")!;

  const bottom = rowY + rowH + BREAK_FOOTROOM;
  const height = bottom - y + 4;

  return {
    rug: { x: x + 1, y: y + 1, w: width - 2, h: height - 2 },
    sofa,
    table,
    coffee,
    bench,
    pingPong,
    pool,
    foosball,
    cocktail,
    dining,
    // Sitters sit 4px above their seat so the body overlaps it.
    sofaSeats: [
      { x: sofa.x + 1, y: sofa.y - 5 },
      { x: sofa.x + 9, y: sofa.y - 5 },
    ],
    benchSeats: [
      { x: bench.x + 1, y: bench.y - 5 },
      { x: bench.x + 8, y: bench.y - 5 },
    ],
    standSpots: [{ x: coffee.x - 11, y: coffee.y + 1 }],
    pingPongSpots: [
      { x: pingPong.x - 11, y: pingPong.y - 2 },
      { x: pingPong.x + pingPong.w + 2, y: pingPong.y - 2 },
    ],
    poolSpots: [
      { x: pool.x - 11, y: pool.y - 2 },
      { x: pool.x + pool.w + 2, y: pool.y - 2 },
    ],
    foosballSpots: [
      { x: foosball.x - 11, y: foosball.y - 2 },
      { x: foosball.x + foosball.w + 2, y: foosball.y - 2 },
    ],
    // Drinkers stand along the near side of the counter, facing it.
    cocktailSpots: [
      { x: cocktail.x + 1, y: cocktail.y + cocktail.h },
      { x: cocktail.x + 11, y: cocktail.y + cocktail.h },
    ],
    // Two seats along each long edge, sat the way the sofa is.
    diningSeats: [
      { x: dining.x + 2, y: dining.y - 5 },
      { x: dining.x + 16, y: dining.y - 5 },
      { x: dining.x + 2, y: dining.y + dining.h - 3 },
      { x: dining.x + 16, y: dining.y + dining.h - 3 },
    ],
    // Behind the counter, facing the customers.
    bartender: { x: cocktail.x + 4, y: cocktail.y - 9 },
    overflowY: bottom,
    height,
  };
}

export function loungeFurniture(room: Room): BreakRoomFurniture {
  return room.furniture;
}

/**
 * Places people in the common area: the sofa first, then the bench, then
 * standing by the coffee machine, then loose rows for any overflow.
 */
export function loungeSpots(room: Room, count: number): Spot[] {
  const l = room.lounge;
  const f = room.furniture;
  const spots: Spot[] = [];

  f.sofaSeats.forEach((p, i) =>
    spots.push({ id: `lounge:sofa:${i}`, zone: "lounge", pose: "sofa", ...p }),
  );
  f.benchSeats.forEach((p, i) =>
    spots.push({ id: `lounge:bench:${i}`, zone: "lounge", pose: "bench", ...p }),
  );
  f.diningSeats.forEach((p, i) =>
    spots.push({ id: `lounge:dining:${i}`, zone: "lounge", pose: "bench", ...p }),
  );
  f.standSpots.forEach((p, i) =>
    spots.push({ id: `lounge:stand:${i}`, zone: "lounge", pose: "stand", ...p }),
  );

  let overflow = 0;
  const perRow = Math.max(1, Math.floor((l.w - 6) / 11));
  while (spots.length < count) {
    spots.push({
      id: `lounge:extra:${overflow}`,
      zone: "lounge",
      pose: "stand",
      x: l.x + 3 + (overflow % perRow) * 11,
      y: f.overflowY + Math.floor(overflow / perRow) * 14,
    });
    overflow++;
  }
  return spots;
}

/** The desk spot for a slot: where the character body sits. */
export function deskSpot(slot: DeskSlot): Spot {
  return {
    id: `desk:${slot.index}`,
    zone: "desk",
    pose: "desk",
    x: slot.x + SEAT_CHAR_DX,
    y: slot.y + SEAT_CHAR_DY,
  };
}
