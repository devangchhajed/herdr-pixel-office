import { Screen, truncate } from "./screen";
import {
  Color,
  HAIR_COLORS,
  PALETTE,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  mix,
  shade,
} from "./palette";

/**
 * Art is measured in subpixels: quadrant rendering makes one half a cell wide
 * and half a cell tall, so a 10x10 figure occupies 5 columns by 5 rows. Every
 * pose is authored so no 2x2 cell needs more than two colours — see
 * Screen.measureQuantisation, which is what keeps it crisp rather than smeared.
 */
/**
 * Under quadrant rendering a subpixel is half a cell wide but a whole half-row
 * tall — roughly 2:1. Art must therefore be about twice as wide as it is tall
 * to look square on screen; a 10x10 figure renders at a physical 0.45 width:
 * height and looks squeezed.
 *
 * The face needs FIVE cell-pairs across: skin, eye, skin, eye, skin. At 10
 * subpixels that is the entire width, so the face rows carry no side outline —
 * the hair and body above and below still do, which is enough silhouette. Drop
 * to four pairs and one eye ends up against the outline and merges into it,
 * reading as a character with a single eye.
 */
export const CHAR_W = 10;
export const SEATED_H = 8;
export const STANDING_H = 10;

export type Facing = "down" | "up" | "left" | "right";
export type SeatedPose = "type" | "read" | "idle" | "raise" | "lean";

export interface CharacterLook {
  skin: Color;
  hair: Color;
  shirt: Color;
  sleeve: Color;
  pants: Color;
  shoe: Color;
}

/** Stable per-agent appearance: the same agent id always gets the same character. */
export function lookFor(seed: string): CharacterLook {
  const h = hash(seed);
  const skin = SKIN_TONES[h % SKIN_TONES.length];
  const hair = HAIR_COLORS[(h >> 3) % HAIR_COLORS.length];
  const shirt = SHIRT_COLORS[(h >> 6) % SHIRT_COLORS.length];
  const pants = PANTS_COLORS[(h >> 9) % PANTS_COLORS.length];
  return { skin, hair, shirt, sleeve: shade(shirt, 0.78), pants, shoe: 0x20232b };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const SEATED_FRONT = [
  "..oooooo..",
  ".ohhhhhho.",
  "HHSSSSSSHH",
  "SSEESSEESS",
  "SSSSnnSSSS",
  "ooSSSSSSoo",
  "ooBBBBBBoo",
  "oABBBBBBAo",
];

const STANDING_FRONT = [
  "..oooooo..",
  ".ohhhhhho.",
  "HHSSSSSSHH",
  "SSEESSEESS",
  "SSSSnnSSSS",
  "ooSSSSSSoo",
  "ooBBBBBBoo",
  "oABBBBBBAo",
  "ooPP..PPoo",
  "ooKK..KKoo",
];

const STANDING_BACK = [
  "..oooooo..",
  ".ohhhhhho.",
  "HHHHHHHHHH",
  "HHHHHHHHHH",
  "HHHHHHHHHH",
  "ooSSSSSSoo",
  "ooBBBBBBoo",
  "oABBBBBBAo",
  "ooPP..PPoo",
  "ooKK..KKoo",
];

const STANDING_SIDE = [
  "..oooooo..",
  ".ohhhhhho.",
  "HHHHSSSSSS",
  "HHSSSSEESS",
  "SSSSSSnnSS",
  "ooSSSSSSoo",
  "ooBBBBBBoo",
  "oAABBBBBBo",
  "ooPPPPPPoo",
  "ooKKKKKKoo",
];

/**
 * Mid-stride legs, swapped in over the standing art's last two rows. Two
 * variants per facing give a 4-phase cycle (neutral, A, neutral, B) rather than
 * the 2-frame flip-flop, which reads as a limp at 12fps.
 */
const STRIDE_FRONT_A = ["ooPPPP..oo", "ooKKKK..oo"];
const STRIDE_FRONT_B = ["oo..PPPPoo", "oo..KKKKoo"];
const STRIDE_SIDE_A = ["ooPPPP..oo", "ooKKKK..oo"];
const STRIDE_SIDE_B = ["oo..PPPPoo", "oo..KKKKoo"];

function mirror(art: string[]): string[] {
  return art.map((row) => row.split("").reverse().join(""));
}

function paletteFor(look: CharacterLook): Record<string, Color> {
  return {
    H: look.hair,
    h: shade(look.hair, 1.45),
    S: look.skin,
    n: shade(look.skin, 0.78),
    E: eyeFor(look.skin),
    B: look.shirt,
    c: shade(look.shirt, 1.3),
    A: look.sleeve,
    P: look.pants,
    K: look.shoe,
    o: OUTLINE,
  };
}

/** One dark outline for every figure, so a silhouette never dissolves into the floor. */
const OUTLINE = 0x14161c;

/**
 * Eyes have to contrast with the face, not with the palette in the abstract —
 * a near-black eye on a dark skin tone disappears, which is most of what made
 * the characters look smudged.
 */
function eyeFor(skin: Color): Color {
  const luma = ((skin >> 16) & 0xff) * 0.299 + ((skin >> 8) & 0xff) * 0.587 + (skin & 0xff) * 0.114;
  return luma < 110 ? 0xf0e6dc : 0x1b1b22;
}

/**
 * Draws the body of a character sitting at a desk. Hands are a separate call so
 * the caller can paint them after the desk and monitor, keeping them on top.
 */
export function drawSeated(
  screen: Screen,
  x: number,
  y: number,
  look: CharacterLook,
  pose: SeatedPose,
): void {
  const pal = paletteFor(look);
  screen.drawArt(x, seatedBodyY(y, pose), SEATED_FRONT, pal);
}

/** Where the body art starts; "lean" slouches a pixel further from the desk. */
export function seatedBodyY(y: number, pose: SeatedPose): number {
  // 2, not 1: an odd offset puts the body half a cell off the grid, so every
  // cell straddles two art rows and the face smears.
  return pose === "lean" ? y + 2 : y;
}

/** Hands and raised arms, drawn over the desk surface. */
export function drawSeatedHands(
  screen: Screen,
  x: number,
  y: number,
  look: CharacterLook,
  pose: SeatedPose,
  frame: number,
): void {
  const bodyY = seatedBodyY(y, pose);
  const skin = look.skin;

  switch (pose) {
    case "type": {
      // Hands alternate between resting and a raised keystroke.
      const left = frame % 2 === 0 ? 1 : 0;
      const right = frame % 2 === 0 ? 0 : 1;
      hand(screen, x + 1, bodyY + 8 + left, skin);
      hand(screen, x + 8, bodyY + 8 + right, skin);
      break;
    }
    case "read": {
      // Holding something up to read: a page between two raised hands.
      const lift = Math.floor(frame / 8) % 2;
      const pageY = bodyY + 6 - lift;
      screen.fillRect(x + 3, pageY, 4, 2, PALETTE.page);
      screen.hLine(x + 3, pageY, 4, PALETTE.pageEdge);
      hand(screen, x + 1, pageY, skin);
      hand(screen, x + 8, pageY, skin);
      break;
    }
    case "idle": {
      const bob = Math.floor(frame / 6) % 2;
      hand(screen, x + 1, bodyY + 8 + bob, skin);
      hand(screen, x + 8, bodyY + 8 + bob, skin);
      break;
    }
    case "raise": {
      // One arm up: the "I need you" pose that pairs with the ... bubble.
      hand(screen, x + 1, bodyY + 8, skin);
      screen.setPixel(x + 8, bodyY + 6, look.sleeve);
      screen.setPixel(x + 8, bodyY + 5, skin);
      hand(screen, x + 8, bodyY + 3, skin);
      break;
    }
    case "lean": {
      // Hands behind the head, chair pushed back.
      hand(screen, x - 1, bodyY + 3, skin);
      hand(screen, x + 10, bodyY + 3, skin);
      break;
    }
  }
}

function hand(screen: Screen, x: number, y: number, skin: Color): void {
  screen.setPixel(x, y, skin);
}

export function drawStanding(
  screen: Screen,
  x: number,
  y: number,
  look: CharacterLook,
  facing: Facing,
  frame: number,
  moving: boolean,
): void {
  const pal = paletteFor(look);
  let art: string[];
  let strideA: string[];
  let strideB: string[];

  switch (facing) {
    case "up":
      art = STANDING_BACK;
      strideA = STRIDE_FRONT_A;
      strideB = STRIDE_FRONT_B;
      break;
    case "left":
      art = mirror(STANDING_SIDE);
      strideA = mirror(STRIDE_SIDE_A);
      strideB = mirror(STRIDE_SIDE_B);
      break;
    case "right":
      art = STANDING_SIDE;
      strideA = STRIDE_SIDE_A;
      strideB = STRIDE_SIDE_B;
      break;
    default:
      art = STANDING_FRONT;
      strideA = STRIDE_FRONT_A;
      strideB = STRIDE_FRONT_B;
      break;
  }

  if (moving) {
    const phase = Math.floor(frame / 2) % 4;
    if (phase === 1) art = art.slice(0, art.length - 2).concat(strideA);
    else if (phase === 3) art = art.slice(0, art.length - 2).concat(strideB);
  }
  screen.drawArt(x, y, art, pal);
}

/** The white ring that marks the selected character. */
export function drawSelection(screen: Screen, x: number, y: number, w: number, h: number): void {
  const c = PALETTE.selection;
  for (let i = 0; i < w; i += 2) {
    screen.setPixel(x + i, y - 1, c);
    screen.setPixel(x + i, y + h, c);
  }
  for (let i = 0; i < h; i += 2) {
    screen.setPixel(x - 1, y + i, c);
    screen.setPixel(x + w, y + i, c);
  }
}

export type BubbleKind = "waiting" | "question" | "done";

/**
 * Speech bubble above a character: animated dots while an agent is blocked,
 * a checkmark that fades out after it finishes a turn.
 */
export function drawBubble(
  screen: Screen,
  cx: number,
  bottomY: number,
  kind: BubbleKind,
  frame: number,
  alpha: number,
): void {
  if (alpha <= 0.02) return;
  const w = 13;
  const h = 6;
  const x = cx - Math.floor(w / 2);
  const y = bottomY - h;

  const bg = mix(PALETTE.floorA, 0xf2f4f8, alpha);
  const edge = mix(PALETTE.floorA, 0x9aa3b4, alpha);

  screen.fillRect(x + 1, y, w - 2, h - 1, bg);
  screen.fillRect(x, y + 1, w, h - 3, bg);
  screen.hLine(x + 1, y, w - 2, edge);
  screen.hLine(x + 1, y + h - 2, w - 2, edge);
  // tail
  screen.setPixel(cx, y + h - 1, bg);

  if (kind === "question") {
    // "?" - the agent asked you something and is blocked on the answer.
    const ink = mix(bg, 0x2b303a, alpha);
    screen.hLine(x + 2, y + 1, 2, ink);
    screen.setPixel(x + 4, y + 2, ink);
    screen.setPixel(x + 3, y + 2, ink);
    screen.setPixel(x + 3, y + 3, ink);
  } else if (kind === "waiting") {
    const ink = mix(bg, 0x2b303a, alpha);
    const lit = Math.floor(frame / 3) % 4;
    for (let i = 0; i < 3; i++) {
      const on = i < lit;
      screen.setPixel(x + 2 + i, y + 2, on ? ink : mix(bg, 0x9aa3b4, alpha * 0.5));
    }
  } else {
    const ink = mix(bg, 0x2f9e5f, alpha);
    // small check mark
    screen.setPixel(x + 2, y + 2, ink);
    screen.setPixel(x + 3, y + 3, ink);
    screen.setPixel(x + 4, y + 2, ink);
    screen.setPixel(x + 5, y + 1, ink);
  }
}

/* ------------------------------------------------------------------ */
/* Furniture                                                           */
/* ------------------------------------------------------------------ */

export const DESK_W = 18;

export function drawDesk(screen: Screen, x: number, y: number, h: number): void {
  screen.fillRect(x, y, DESK_W, h, PALETTE.deskTop);
  // Two rows, not one: hands rest on this band, and a 1px highlight would put
  // highlight, desk and skin in the same cell — three colours, which smears.
  screen.fillRect(x, y, DESK_W, 2, shade(PALETTE.deskTop, 1.12));
  screen.hLine(x, y + h - 1, DESK_W, PALETTE.deskEdge);
  // Grain sits below the 2px highlight band, not inside it: hands rest on that
  // band, and grain there would put grain, highlight and skin in one cell.
  for (let i = 4; i < DESK_W - 3; i += 8) {
    screen.fillRect(x + i, y + 3, 4, 2, PALETTE.deskGrain);
  }
}

export function drawChair(screen: Screen, x: number, y: number): void {
  // Every edge is 2px. A 1px edge lands inside a cell alongside the chair fill
  // and whatever sprite sits on it — three colours, which smears.
  screen.fillRect(x, y, 14, 8, PALETTE.chair);
  screen.fillRect(x, y, 14, 2, PALETTE.chairShade);
  screen.fillRect(x, y, 2, 8, PALETTE.chairShade);
  screen.fillRect(x + 12, y, 2, 8, PALETTE.chairShade);
}

/**
 * An open laptop: palm rest and trackpad nearest its owner — which is where the
 * hands land — then the keys, then the screen standing up beyond.
 *
 * What makes it read as a laptop rather than a dark slab is that the BASE is
 * wider than the screen and visibly proud of it on both sides; that silhouette
 * matters more than any internal detail.
 *
 * The display is 8 subpixels wide by 2 tall. A subpixel is half a cell wide but
 * a whole half-row tall, so that is a physical 4 : 2.2 — essentially 16:9. Make
 * it narrower and the screen turns portrait: at 2 wide it renders at 0.45,
 * which reads as a squeezed sliver rather than a laptop screen.
 */
const LAPTOP_ART = [
  "KKKKKKttKKKKKK",
  "KKKKKKttKKKKKK",
  "KKkkkkkkkkkkKK",
  "KKkkkkkkkkkkKK",
  ".BBBBBBBBBBBB.",
  ".BBDDDDDDDDBB.",
  ".BBDDDDDDDDBB.",
  ".BBBBBBBBBBBB.",
];

export const LAPTOP_W = 14;
export const LAPTOP_H = 8;

export function drawMonitor(screen: Screen, x: number, y: number, glow: Color, lit: number): void {
  screen.drawArt(x, y, LAPTOP_ART, {
    K: PALETTE.laptopBase,
    t: PALETTE.laptopPad,
    k: PALETTE.laptopKeys,
    B: PALETTE.monitorBody,
    D: lit <= 0 ? PALETTE.screenOff : mix(PALETTE.screenOff, glow, lit),
  });
}

export function drawPlant(screen: Screen, x: number, y: number): void {
  screen.fillRect(x + 2, y + 4, 6, 2, PALETTE.plantPot);
  screen.hLine(x + 2, y + 4, 6, shade(PALETTE.plantPot, 1.15));
  screen.drawArt(x, y, [
    "..LL..LL..",
    "LLDDLLDDLL",
    "..LLDDLL..",
    "....LL....",
  ], { L: PALETTE.plantLeaf, D: PALETTE.plantLeafDark });
}

export function drawCooler(screen: Screen, x: number, y: number): void {
  screen.fillRect(x + 2, y, 6, 3, PALETTE.cooler);
  screen.fillRect(x, y + 3, 10, 4, PALETTE.coolerBody);
  screen.hLine(x, y + 5, 10, shade(PALETTE.coolerBody, 0.8));
}

export function drawRug(screen: Screen, x: number, y: number, w: number, h: number): void {
  screen.fillRect(x, y, w, h, PALETTE.rug);
  screen.strokeRect(x, y, w, h, PALETTE.rugAccent);
  screen.strokeRect(x + 2, y + 2, w - 4, h - 4, PALETTE.rugAccent);
}

/* ------------------------------------------------------------------ */
/* Common-area furniture                                               */
/* ------------------------------------------------------------------ */

/** Sofa seen from the front: a back panel with cushions, sitters drawn on top. */
export function drawSofa(screen: Screen, x: number, y: number, w: number, h: number): void {
  const seats = 2;
  const armW = 2;
  screen.fillRect(x, y, w, h, PALETTE.sofa);
  // Back panel sits above the seat, so sitters overlap the cushions naturally.
  screen.fillRect(x, y, w, 3, PALETTE.sofaShade);
  screen.fillRect(x, y + h - 2, w, 2, PALETTE.sofaShade);
  screen.fillRect(x, y, armW, h, PALETTE.sofaShade);
  screen.fillRect(x + w - armW, y, armW, h, PALETTE.sofaShade);

  const cushionW = Math.floor((w - armW * 2) / seats);
  for (let i = 0; i < seats; i++) {
    screen.fillRect(x + armW + i * cushionW + 1, y + 3, cushionW - 2, h - 5, PALETTE.sofaCushion);
  }
}

export function drawCoffeeTable(screen: Screen, x: number, y: number, w: number, h: number): void {
  screen.fillRect(x, y, w, h, PALETTE.tableTop);
  screen.hLine(x, y, w, shade(PALETTE.tableTop, 1.15));
  screen.hLine(x, y + h - 1, w, PALETTE.tableShade);
  // A mug someone left behind.
  screen.fillRect(x + 2, y + 1, 2, 2, 0xd8dee9);
  screen.setPixel(x + 4, y + 2, PALETTE.tableShade);
}

export function drawBench(screen: Screen, x: number, y: number, w: number, h: number): void {
  screen.fillRect(x, y, w, h, PALETTE.benchTop);
  screen.fillRect(x, y, w, 2, shade(PALETTE.benchTop, 0.82));
  screen.hLine(x, y + h - 1, w, PALETTE.tableShade);
  screen.vLine(x + 1, y + 2, h - 2, PALETTE.tableShade);
  screen.vLine(x + w - 2, y + 2, h - 2, PALETTE.tableShade);
}

/** Coffee machine: the reason anyone stands up in the first place. */
export function drawCoffeeMachine(screen: Screen, x: number, y: number, w: number, h: number): void {
  screen.fillRect(x, y, w, h, PALETTE.coffeeBody);
  screen.hLine(x, y, w, shade(PALETTE.coffeeBody, 1.5));
  screen.fillRect(x + 1, y + 2, w - 2, 3, shade(PALETTE.coffeeBody, 1.9));
  screen.fillRect(x + 2, y + 6, w - 4, 3, PALETTE.coffeePot);
  screen.hLine(x, y + h - 1, w, shade(PALETTE.coffeeBody, 0.7));
}

export function drawPainting(screen: Screen, x: number, y: number, alt: boolean): void {
  screen.fillRect(x, y, 10, 4, PALETTE.frame);
  screen.fillRect(x + 2, y + 1, 6, 2, alt ? PALETTE.canvasB : PALETTE.canvasA);
  screen.hLine(x + 4, y + 1, 2, shade(alt ? PALETTE.canvasB : PALETTE.canvasA, 1.4));
}

export function drawClock(screen: Screen, x: number, y: number): void {
  screen.fillRect(x, y, 8, 4, PALETTE.coolerBody);
  screen.strokeRect(x, y, 8, 4, PALETTE.frame);
  screen.hLine(x + 3, y + 1, 2, 0x1b1b22);
  screen.hLine(x + 4, y + 2, 2, 0x1b1b22);
}

export function drawBookshelf(screen: Screen, x: number, y: number): void {
  screen.fillRect(x, y, 16, 7, PALETTE.shelf);
  for (let row = 0; row < 2; row++) {
    const sy = y + 1 + row * 3;
    for (let i = 0; i < 7; i++) {
      const c = i % 3 === 0 ? PALETTE.book : i % 3 === 1 ? PALETTE.canvasA : PALETTE.plantLeaf;
      screen.fillRect(x + 1 + i * 2, sy, 2, 2, c);
    }
    screen.hLine(x, sy + 2, 16, shade(PALETTE.shelf, 0.7));
  }
}

export function drawBin(screen: Screen, x: number, y: number): void {
  screen.fillRect(x + 2, y + 1, 6, 3, PALETTE.bin);
  screen.hLine(x, y, 10, shade(PALETTE.bin, 1.4));
}

/** A character sitting on lounge furniture: body only, no desk to hide the legs. */
export function drawLoungeSitter(
  screen: Screen,
  x: number,
  y: number,
  look: CharacterLook,
): void {
  const pal = paletteFor(look);
  screen.drawArt(x, y, SEATED_FRONT, pal);
  // Hands resting in the lap.
  screen.setPixel(x + 1, y + 9, look.skin);
  screen.setPixel(x + 5, y + 9, look.skin);
}

/**
 * Two 1px gauges under a desk: context window on top, rate-limit usage below.
 * Color ramps green → amber → red so a desk about to run out is visible without
 * reading a number.
 */
export function drawHealthBars(
  screen: Screen,
  x: number,
  y: number,
  w: number,
  contextPct: number | null,
  usagePct: number | null,
): void {
  bar(screen, x, y, w, contextPct);
  bar(screen, x, y + 1, w, usagePct);
}

function bar(screen: Screen, x: number, y: number, w: number, pct: number | null): void {
  if (pct === null) return;
  const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  const color = pct >= 85 ? PALETTE.gaugeHigh : pct >= 60 ? PALETTE.gaugeMid : PALETTE.gaugeLow;
  screen.hLine(x, y, w, PALETTE.gaugeTrack);
  if (filled > 0) screen.hLine(x, y, filled, color);
}

/** A 3x5 mini figure: an ephemeral sub-agent working beside its parent. */
const SUBAGENT_ART = [".oooo.", "oHHHHo", "oSSSSo", "oBBBBo", ".PP.PP"];

/**
 * Sub-agents get their own character near their parent rather than a seat, as
 * in pixel-agents — they exist only for the duration of a task.
 */
export function drawSubAgent(
  screen: Screen,
  x: number,
  y: number,
  look: CharacterLook,
  frame: number,
): void {
  // A small bob so they read as alive, not as furniture.
  const bob = Math.floor(frame / 5) % 2;
  screen.drawArt(x, y + bob, SUBAGENT_ART, {
    H: shade(look.hair, 1.1),
    S: look.skin,
    B: shade(look.shirt, 1.15),
    P: look.pants,
    o: OUTLINE,
  });
}

/** The office cat. 6x5, with a tail that flicks while it walks. */
const PET_ART = ["FF....FF..", "FFFFFFFF..", "FFEEFFEEFT", "FFFFFFFFFT", "LL..LL..LL"];

export function drawPet(
  screen: Screen,
  x: number,
  y: number,
  facing: "left" | "right",
  frame: number,
  moving: boolean,
  happy: boolean,
): void {
  const flick = moving && Math.floor(frame / 4) % 2 === 1;
  const art = facing === "left" ? PET_ART.map((r) => [...r].reverse().join("")) : PET_ART;
  screen.drawArt(x, y, art, {
    F: PALETTE.petFur,
    E: 0x1b1b22,
    T: flick ? PALETTE.petFur : PALETTE.petFurDark,
    L: PALETTE.petFurDark,
  });
  if (happy) {
    // A little heart when you click it.
    const c = PALETTE.petHeart;
    screen.setPixel(x + 1, y - 2, c);
    screen.setPixel(x + 3, y - 2, c);
    screen.hLine(x + 1, y - 1, 3, c);
    screen.setPixel(x + 2, y, c);
  }
}

/* ------------------------------------------------------------------ */
/* Games                                                               */
/* ------------------------------------------------------------------ */

/**
 * Table tennis, seen from above: blue top, white lines, a net across the
 * middle. `ballT` runs 0..1 left to right; the ball arcs so it reads as a rally
 * rather than a slider.
 */
export function drawPingPongTable(
  screen: Screen,
  r: { x: number; y: number; w: number; h: number },
  ballT: number | null,
): void {
  screen.fillRect(r.x, r.y, r.w, r.h, PALETTE.ttTop);
  screen.strokeRect(r.x, r.y, r.w, r.h, PALETTE.ttEdge);
  // Centre line down the length of the table.
  screen.hLine(r.x + 1, r.y + Math.floor(r.h / 2), r.w - 2, PALETTE.ttLine);
  // Net across the middle.
  const netX = r.x + Math.floor(r.w / 2);
  screen.vLine(netX, r.y - 1, r.h + 2, PALETTE.ttNet);

  if (ballT === null) return;
  const bx = Math.round(r.x + 2 + ballT * (r.w - 5));
  // A shallow arc: highest at the net, lowest at the paddles.
  const arc = Math.sin(ballT * Math.PI) * 3;
  const by = Math.round(r.y + r.h / 2 - arc);
  screen.setPixel(bx, by, PALETTE.ball);
  screen.setPixel(bx, by - 1, PALETTE.ball);
}

/** Pool table: green felt, rails, corner pockets and a few balls. */
export function drawPoolTable(
  screen: Screen,
  r: { x: number; y: number; w: number; h: number },
  frame: number,
  playing: boolean,
): void {
  screen.fillRect(r.x, r.y, r.w, r.h, PALETTE.poolRail);
  screen.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, PALETTE.poolFelt);

  // Pockets at the corners and the middle of each long rail.
  const pockets = [
    [r.x + 1, r.y + 1],
    [r.x + r.w - 2, r.y + 1],
    [r.x + 1, r.y + r.h - 2],
    [r.x + r.w - 2, r.y + r.h - 2],
    [r.x + Math.floor(r.w / 2), r.y + 1],
    [r.x + Math.floor(r.w / 2), r.y + r.h - 2],
  ];
  for (const [px, py] of pockets) screen.setPixel(px, py, PALETTE.poolPocket);

  // Balls drift a pixel now and then, but only while someone is playing.
  const jitter = playing ? Math.floor(frame / 24) % 2 : 0;
  const balls: [number, number, number][] = [
    [r.x + 6, r.y + 4, PALETTE.ballRed],
    [r.x + 9, r.y + 7, PALETTE.ballYellow],
    [r.x + 13 + jitter, r.y + 5, PALETTE.ballRed],
    [r.x + 16, r.y + 8 - jitter, PALETTE.ballYellow],
    [r.x + 19, r.y + 4, PALETTE.ball],
  ];
  for (const [bx, by, color] of balls) {
    if (bx >= r.x + r.w - 2) continue;
    screen.setPixel(bx, by, color);
  }
}

/** A paddle held out toward the table; swings on the beat. */
export function drawPaddle(
  screen: Screen,
  x: number,
  y: number,
  facing: "left" | "right",
  swing: boolean,
): void {
  const dx = facing === "right" ? 1 : -1;
  const reach = swing ? 3 : 2;
  screen.setPixel(x + dx * (reach - 1), y, PALETTE.paddleGrip);
  screen.fillRect(x + dx * reach - (facing === "left" ? 1 : 0), y - 1, 2, 3, PALETTE.paddle);
}

/** A cue stick lined up at the table. */
export function drawCue(
  screen: Screen,
  x: number,
  y: number,
  facing: "left" | "right",
  strike: boolean,
): void {
  const dx = facing === "right" ? 1 : -1;
  const len = strike ? 5 : 7;
  for (let i = 1; i <= len; i++) screen.setPixel(x + dx * i, y + Math.floor(i / 3), PALETTE.cue);
}

/** A takeaway cup in a character's hand. */
export function drawCup(screen: Screen, x: number, y: number): void {
  screen.fillRect(x, y, 2, 2, PALETTE.cup);
  screen.hLine(x, y - 1, 2, PALETTE.cupLid);
}

/* ------------------------------------------------------------------ */
/* Wall header                                                         */
/* ------------------------------------------------------------------ */

/** A plaque is 3 rows: frame, one row of text, frame. */
export const PLAQUE_H = 6;

export interface PlaqueStyle {
  frame: Color;
  surface: Color;
  ink: Color;
}

/** Width a plaque needs to hold `text`, in subpixels. */
export function plaqueWidth(text: string): number {
  return text.length * 2 + 8;
}

/**
 * A small framed plaque on the wall. The company name, the clock and the notice
 * all use one of these and share a single row.
 *
 * They replaced a seven-segment clock, a corkboard and a nameplate stacked down
 * the wall, which together cost 14 rows — nearly half a pane — before a desk was
 * drawn. Text on the overlay costs one row and stays legible at any length.
 */
export function drawPlaque(
  screen: Screen,
  x: number,
  y: number,
  text: string,
  style: PlaqueStyle,
): void {
  const w = plaqueWidth(text);
  screen.fillRect(x, y, w, PLAQUE_H, style.frame);
  screen.fillRect(x + 2, y + 2, w - 4, 2, style.surface);
  const cols = Math.floor((w - 4) / 2);
  screen.putTextCentered(
    Math.round((x + 2) / 2),
    (y + 2) / 2,
    cols,
    truncate(text, cols),
    style.ink,
    style.surface,
  );
}

/* ------------------------------------------------------------------ */
/* Pixel clock                                                         */
/* ------------------------------------------------------------------ */

/** Digit cell: 8 subpixels wide by 10 tall — about 4 columns by 5 rows. */
export const CLOCK_DIGIT_W = 8;
export const CLOCK_DIGIT_H = 10;
/** Digits plus the caption row beneath them. */
export const CLOCK_H = 12;
const CLOCK_COLON_W = 4;
const CLOCK_GAP = 2;

/**
 * Seven-segment geometry. Every segment is 2 subpixels thick on an even offset,
 * so each cell falls entirely inside one segment or outside it and the digits
 * stay pixel-exact. Five 2px bands is the floor for seven segments, which is
 * why the face cannot be shorter than 10 subpixels.
 */
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [2, 0, 4, 2],
  f: [0, 2, 2, 2],
  b: [6, 2, 2, 2],
  g: [2, 4, 4, 2],
  e: [0, 6, 2, 2],
  c: [6, 6, 2, 2],
  d: [2, 8, 4, 2],
};

const DIGIT_SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

export function clockDigitsWidth(time: string): number {
  let w = 0;
  for (const ch of time) w += (ch === ":" ? CLOCK_COLON_W : CLOCK_DIGIT_W) + CLOCK_GAP;
  return Math.max(0, w - CLOCK_GAP);
}

export function clockWidth(time: string, caption: string): number {
  return Math.max(clockDigitsWidth(time), caption.length * 2);
}

/**
 * Seven-segment time with a caption under it. Unlit segments are drawn faintly
 * rather than skipped, the way an LED display shows its ghost segments —
 * without them a "1" reads as a floating stripe.
 */
export function drawPixelClock(
  screen: Screen,
  x: number,
  y: number,
  time: string,
  caption: string,
  colonLit: boolean,
): void {
  const inner = clockWidth(time, caption);
  let cursor = (x + Math.floor((inner - clockDigitsWidth(time)) / 2)) & ~1;

  for (const ch of time) {
    if (ch === " ") {
      cursor += CLOCK_DIGIT_W + CLOCK_GAP;
      continue;
    }
    if (ch === ":") {
      const colour = colonLit ? PALETTE.clockInk : PALETTE.clockDim;
      screen.fillRect(cursor + 1, y + 2, 2, 2, colour);
      screen.fillRect(cursor + 1, y + 6, 2, 2, colour);
      cursor += CLOCK_COLON_W + CLOCK_GAP;
      continue;
    }
    const lit = DIGIT_SEGMENTS[ch] ?? "";
    for (const [name, rect] of Object.entries(SEGMENTS)) {
      const [dx, dy, sw, sh] = rect;
      screen.fillRect(
        cursor + dx, y + dy, sw, sh,
        lit.includes(name) ? PALETTE.clockInk : PALETTE.clockDim,
      );
    }
    cursor += CLOCK_DIGIT_W + CLOCK_GAP;
  }

  const cols = Math.floor(inner / 2);
  screen.putTextCentered(
    Math.round(x / 2),
    (y + CLOCK_DIGIT_H) / 2,
    cols,
    truncate(caption, cols),
    PALETTE.clockInk,
    PALETTE.wall,
  );
}

/* ------------------------------------------------------------------ */
/* Foosball and the cocktail bar                                       */
/* ------------------------------------------------------------------ */

/**
 * A foosball table seen from above: wooden frame, green field, goals at each
 * end and four rods across it carrying red and blue figures. The rods alternate
 * colour so the two sides read as two sides.
 */
export function drawFoosball(
  screen: Screen,
  r: { x: number; y: number; w: number; h: number },
  frame: number,
  playing: boolean,
): void {
  screen.fillRect(r.x, r.y, r.w, r.h, PALETTE.foosFrame);
  screen.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, PALETTE.foosField);
  // Halfway line.
  screen.vLine(r.x + Math.floor(r.w / 2), r.y + 2, r.h - 4, shade(PALETTE.foosField, 1.3));
  // Goal mouths.
  screen.fillRect(r.x, r.y + Math.floor(r.h / 2) - 2, 2, 4, PALETTE.foosGoal);
  screen.fillRect(r.x + r.w - 2, r.y + Math.floor(r.h / 2) - 2, 2, 4, PALETTE.foosGoal);

  // Rods. The figures only move while two people are actually on the handles —
  // a table playing itself in an empty room is the same bug the ping-pong ball
  // had.
  const bob = playing ? Math.floor(frame / 6) % 2 : 0;
  for (let i = 0; i < 4; i++) {
    const x = r.x + 5 + i * Math.floor((r.w - 10) / 3);
    screen.fillRect(x, r.y + 2, 2, r.h - 4, PALETTE.foosRod);
    const colour = i % 2 === 0 ? PALETTE.foosRed : PALETTE.foosBlue;
    const offset = i % 2 === 0 ? bob : 1 - bob;
    screen.fillRect(x, r.y + 3 + offset, 2, 2, colour);
    screen.fillRect(x, r.y + r.h - 7 + offset, 2, 2, colour);
  }
}

/**
 * A staffed cocktail counter: bottles on a back shelf, a polished bar top and
 * a panelled front. People stand on the near side of it.
 */
export function drawCocktailBar(
  screen: Screen,
  r: { x: number; y: number; w: number; h: number },
  frame: number,
): void {
  // Back shelf with bottles.
  screen.fillRect(r.x, r.y, r.w, 4, PALETTE.barShelf);
  const bottles = [PALETTE.barBottleA, PALETTE.barBottleB, PALETTE.barBottleC];
  for (let i = 0; i * 4 + 2 < r.w - 2; i++) {
    screen.fillRect(r.x + 2 + i * 4, r.y + 1, 2, 3, bottles[i % bottles.length]);
  }
  // Polished bar top, then the panelled front below it. Two distinct bands:
  // filling the same rect twice just painted the second colour over the first.
  screen.fillRect(r.x, r.y + 4, r.w, 2, shade(PALETTE.barTop, 1.15));
  screen.fillRect(r.x, r.y + 6, r.w, 2, PALETTE.barTop);
  screen.fillRect(r.x, r.y + 8, r.w, r.h - 8, PALETTE.barFront);
  // A glass being made, catching the light on alternate beats.
  const lit = Math.floor(frame / 8) % 2 === 0;
  screen.fillRect(r.x + r.w - 6, r.y + 2, 2, 2, lit ? PALETTE.barGlass : PALETTE.barBottleA);
}

/** A cocktail glass in hand. */
export function drawGlass(screen: Screen, x: number, y: number): void {
  screen.fillRect(x, y, 2, 2, PALETTE.barGlass);
  screen.setPixel(x, y + 2, PALETTE.barFront);
}

/* ------------------------------------------------------------------ */
/* Dining table and bar staff                                          */
/* ------------------------------------------------------------------ */

/**
 * A communal table for drinks and lunch: wooden top with a laid place setting
 * at each seat, and chair backs showing along both long edges. People sit at
 * the top and bottom edges the way they do on the sofa.
 */
export function drawDiningTable(
  screen: Screen,
  r: { x: number; y: number; w: number; h: number },
): void {
  // Chair backs, 2px so they never share a cell with the floor and the top.
  screen.fillRect(r.x + 4, r.y, r.w - 8, 2, PALETTE.diningChair);
  screen.fillRect(r.x + 4, r.y + r.h - 2, r.w - 8, 2, PALETTE.diningChair);
  // Table top.
  screen.fillRect(r.x, r.y + 2, r.w, r.h - 4, PALETTE.diningTop);
  screen.fillRect(r.x, r.y + 2, r.w, 2, shade(PALETTE.diningTop, 1.12));
  screen.fillRect(r.x, r.y + r.h - 4, r.w, 2, PALETTE.diningEdge);
  // Place settings.
  for (let i = 0; i < 2; i++) {
    const x = r.x + 6 + i * Math.floor((r.w - 12) / 1 || 1);
    screen.fillRect(Math.min(x, r.x + r.w - 6), r.y + 4, 4, 2, PALETTE.diningPlate);
  }
}

/**
 * The bartender: always behind the counter, shaking something. Not an agent —
 * no session, no seat, never wanders. A bar nobody is working reads as closed.
 */
export function drawBartender(screen: Screen, x: number, y: number, frame: number): void {
  const look = lookFor("bartender");
  const shake = Math.floor(frame / 4) % 2;
  drawStanding(screen, x, y, look, "down", frame, false);
  // Shaker, moving between two positions.
  screen.fillRect(x + CHAR_W - 1, y + 5 - shake, 2, 3, PALETTE.barGlass);
  screen.hLine(x + CHAR_W - 1, y + 4 - shake, 2, PALETTE.barFront);
}
