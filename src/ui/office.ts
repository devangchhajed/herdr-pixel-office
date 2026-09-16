import * as path from "node:path";
import { Character } from "../model/character";
import { Pet } from "../model/pet";
import {
  DESK_SLOT_H,
  DESK_SLOT_W,
  DOOR_W,
  DOOR_X,
  HEADER_X,
  HEADER_Y,
  OfficeArea,
  Room,
  SEAT_CHAIR_DX,
  SEAT_CHAIR_DY,
  SEAT_DESK_DX,
  SEAT_DESK_DY,
  SEAT_DESK_H,
  SEAT_BAR_DY,
  SEAT_LABEL_DY,
  SEAT_MONITOR_DX,
  SEAT_MONITOR_DY,
  loungeFurniture,
} from "../model/office";
import { PALETTE, STATUS_COLOR, mix, shade } from "../render/palette";
import { SUB_X, Screen, truncate } from "../render/screen";
import {
  CHAR_W,
  DESK_W,
  SEATED_H,
  STANDING_H,
  drawBench,
  drawBin,
  drawBookshelf,
  drawBubble,
  drawChair,
  drawCoffeeMachine,
  drawCoffeeTable,
  drawCocktailBar,
  drawCue,
  drawBartender,
  drawDiningTable,
  drawFoosball,
  drawGlass,
  CLOCK_H,
  clockWidth,
  drawPixelClock,
  drawPlaque,
  plaqueWidth,
  drawCup,
  drawCooler,
  drawDesk,
  drawHealthBars,
  drawLoungeSitter,
  drawMonitor,
  drawPainting,
  drawPaddle,
  drawPet,
  drawPingPongTable,
  drawPoolTable,
  drawPlant,
  drawSeated,
  drawSeatedHands,
  drawSelection,
  drawSofa,
  drawStanding,
  drawSubAgent,
  seatedBodyY,
} from "../render/sprites";

export interface OfficeView {
  /** Top and bottom of the drawable region, in screen pixel rows. */
  top: number;
  bottom: number;
  /** Vertical scroll offset into the room, in pixels. */
  camera: number;
  room: Room;
  areas: OfficeArea[];
  characters: Character[];
  selectedId: string | null;
  hoverId: string | null;
  pet: Pet | null;
  /** Global frame counter, for animations that are not per-character. */
  tick: number;
  /** Seven-segment digits, e.g. " 2:02". */
  clock: string;
  /** Caption under the digits, e.g. "PM · WED 16 SEP". */
  clockCaption: string;
  /** Colon blink phase. */
  clockColon: boolean;
  /** Notice board text, empty when there is nothing pinned up. */
  notice: string;
  /** Flash phase, toggling about once a second while a notice is up. */
  noticeFlash: boolean;
  /** Company name for the wall sign; empty when none is set. */
  company: string;
  showNames: boolean;
}

export interface HitBox {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function renderOffice(screen: Screen, view: OfficeView): HitBox[] {
  const { top, bottom, camera } = view;
  const sy = (roomY: number) => roomY - camera + top;

  screen.setClip(0, top, screen.pxW, bottom);

  drawFloor(screen, top, bottom, camera);
  drawAreas(screen, view, sy);
  drawLounge(screen, view, sy);
  drawDeskBank(screen, view, sy);
  drawWall(screen, view, top, camera);
  drawWallHeader(screen, view, sy);
  drawDecor(screen, view, sy);

  if (view.pet) {
    const petY = sy(Math.round(view.pet.y));
    if (petY >= view.top - 6 && petY <= view.bottom) {
      drawPet(
        screen,
        even(view.pet.x),
        even(petY),
        view.pet.facing,
        view.pet.frame,
        view.pet.moving,
        view.pet.happy > 0,
      );
    }
  }

  const hits: HitBox[] = [];
  // Back to front, so characters lower in the room overlap those behind them.
  const ordered = [...view.characters].sort((a, b) => a.y - b.y);
  for (const character of ordered) {
    drawCharacter(screen, view, character, sy, hits);
  }

  screen.resetClip();

  if (view.showNames) {
    for (const character of view.characters) drawNameTag(screen, view, character, sy);
  }
  drawScrollHint(screen, view);
  drawTooltip(screen, view);

  return hits;
}

/* ------------------------------------------------------------------ */
/* Room                                                                */
/* ------------------------------------------------------------------ */

function drawFloor(screen: Screen, top: number, bottom: number, camera: number): void {
  for (let y = top; y < bottom; y++) {
    const roomY = y + camera - top;
    for (let x = 0; x < screen.pxW; x++) {
      // 6px tiles: at 8px the floor grid read larger than the characters.
      // A subpixel is half a cell wide but a half-row tall, so a tile needs
      // about twice the columns of rows to look square.
      const tile = (Math.floor(x / 16) + Math.floor(roomY / 8)) % 2 === 0;
      const seam = x % 16 === 0 || roomY % 8 === 0;
      screen.setPixel(x, y, seam ? PALETTE.floorSeam : tile ? PALETTE.floorA : PALETTE.floorB);
    }
  }
}

function drawWall(screen: Screen, view: OfficeView, top: number, camera: number): void {
  const wallH = view.room.wallH;
  const wallBottom = top - camera + wallH;
  if (wallBottom <= top) return; // scrolled past the top of the room
  const wallTop = top - camera;
  screen.fillRect(0, wallTop, screen.pxW, wallH, PALETTE.wall);
  screen.hLine(0, wallBottom - 1, screen.pxW, PALETTE.wallTrim);
  screen.hLine(0, wallBottom - 2, screen.pxW, shade(PALETTE.wall, 1.35));

  // Doorway on the left that characters walk in through.
  // A door, not a full-height slot: the wall is tall enough to carry the clock
  // now, and a doorway scaled to it would swallow half the back wall.
  const doorH = 12;
  const doorTop = wallBottom - doorH;
  screen.fillRect(DOOR_X, doorTop, DOOR_W, doorH, shade(PALETTE.wall, 1.7));
  screen.fillRect(
    DOOR_X + 2,
    doorTop + 2,
    DOOR_W - 4,
    doorH - 2,
    mix(PALETTE.wall, PALETTE.accent, 0.22),
  );
}

/**
 * The wall header: company, clock and notice as plaques sharing one row.
 * Company sits at the left, clock at the right, notice centred between them so
 * a flashing reminder lands where the eye already is.
 */
function drawWallHeader(screen: Screen, view: OfficeView, sy: (y: number) => number): void {
  const y = sy(HEADER_Y);
  if (y + CLOCK_H < view.top || y > view.bottom) return;

  // Lay out by priority rather than hoping things fit: the clock keeps its
  // place at the right, the reminder gets the next claim on what is left, and
  // the company plaque is the first thing dropped on a narrow pane. Laying them
  // out independently let the notice run straight into the clock at 60 columns.
  let clockLeft = view.room.width - 2;
  if (view.room.showClock && view.clock) {
    const w = clockWidth(view.clock, view.clockCaption);
    clockLeft = (view.room.width - 4 - w) & ~1;
    drawPixelClock(screen, clockLeft, y, view.clock, view.clockCaption, view.clockColon);
  }

  const available = clockLeft - 2 - HEADER_X;
  const companyText = view.company.toUpperCase();
  const companyW = view.company ? plaqueWidth(companyText) : 0;
  const noticeW = view.notice ? plaqueWidth(view.notice) : 0;
  const companyStyle = {
    frame: PALETTE.plaqueFrame,
    surface: PALETTE.plaqueSurface,
    ink: PALETTE.plaqueInk,
  };
  const noticeStyle = view.noticeFlash
    ? { frame: PALETTE.alertFrame, surface: PALETTE.alertSurface, ink: PALETTE.alertInk }
    : {
        frame: PALETTE.plaqueFrame,
        surface: PALETTE.alertIdleSurface,
        ink: PALETTE.alertIdleInk,
      };

  if (view.notice && companyW + 4 + noticeW > available) {
    // Both will not fit: the reminder wins the space.
    if (noticeW <= available) drawPlaque(screen, HEADER_X, y, view.notice, noticeStyle);
    return;
  }

  if (view.company && companyW <= available) {
    drawPlaque(screen, HEADER_X, y, companyText, companyStyle);
  }
  if (!view.notice) return;

  const start = HEADER_X + (view.company && companyW <= available ? companyW + 4 : 0);
  const gap = clockLeft - 2 - start;
  const x = (start + Math.max(0, Math.floor((gap - noticeW) / 2))) & ~1;
  drawPlaque(screen, x, y, view.notice, noticeStyle);
}


function drawDecor(screen: Screen, view: OfficeView, sy: (y: number) => number): void {
  let paintings = 0;
  for (const item of view.room.decor) {
    const y = sy(item.y);
    if (y + 12 < view.top || y > view.bottom) continue;
    switch (item.kind) {
      case "plant":
        drawPlant(screen, item.x, y);
        break;
      case "cooler":
        drawCooler(screen, item.x, y);
        break;
      case "painting":
        drawPainting(screen, item.x, y, paintings++ % 2 === 1);
        break;
      case "bookshelf":
        drawBookshelf(screen, item.x, y);
        break;
      case "bin":
        drawBin(screen, item.x, y);
        break;
    }
  }
}

/**
 * Tinted bands behind the desk rows, one per herdr workspace — the equivalent of
 * pixel-agents' Areas, which map folders to regions of the office.
 */
function drawAreas(screen: Screen, view: OfficeView, sy: (y: number) => number): void {
  if (view.areas.length === 0) return;
  const { deskArea } = view.room;

  for (const area of view.areas) {
    const first = view.room.desks[area.deskStart];
    if (!first) continue;
    const rows = Math.ceil((area.deskEnd - area.deskStart) / Math.max(1, view.room.deskColumns));
    const y = sy(first.y) - 8;
    const h = rows * DESK_SLOT_H;
    if (y + h < view.top || y > view.bottom) continue;

    screen.fillRect(deskArea.x - 1, y, deskArea.w + 2, h, area.color);
    screen.strokeRect(deskArea.x - 1, y, deskArea.w + 2, h, shade(area.color, 1.35));

    // Horizontal, on the band's top edge. That row is clear: the first desk
    // row's bubbles start two subpixels lower, and the row above belongs to the
    // previous band's even columns, whose tags are not staggered.
    const row = Math.floor(y / 2);
    if (row >= Math.floor(view.top / 2) && row < Math.floor(view.bottom / 2)) {
      const label = ` ${truncate(area.label, Math.floor(deskArea.w / SUB_X) - 2)} `;
      screen.putText(
        Math.round(deskArea.x / SUB_X),
        row,
        label,
        PALETTE.textBright,
        shade(area.color, 1.5),
      );
    }
  }
}

/** The desk bank. Desks are drawn whether or not anyone is sitting at them. */
function drawDeskBank(screen: Screen, view: OfficeView, sy: (y: number) => number): void {
  const occupied = new Map<string, Character>();
  for (const c of view.characters) {
    if (c.spot.zone === "desk" && c.phase === "settled" && c.atSpot) occupied.set(c.spot.id, c);
  }

  for (const slot of view.room.desks) {
    const y = sy(slot.y);
    if (y + DESK_SLOT_W + 12 < view.top || y > view.bottom) continue;
    const seated = occupied.get(`desk:${slot.index}`);

    drawChair(screen, slot.x + SEAT_CHAIR_DX, y + SEAT_CHAIR_DY);
    if (seated) {
      const pose = seated.pose;
      drawSeated(screen, even(seated.x), even(sy(seated.y)), seated.look, pose);
    }
    drawDesk(screen, slot.x + SEAT_DESK_DX, y + SEAT_DESK_DY, SEAT_DESK_H);
    drawMonitor(
      screen,
      slot.x + SEAT_MONITOR_DX,
      y + SEAT_MONITOR_DY,
      seated ? STATUS_COLOR[seated.snapshot.status] ?? PALETTE.screenOff : PALETTE.screenOff,
      seated ? seated.screenLit : 0,
    );
    if (seated) {
      drawSeatedHands(
        screen,
        even(seated.x),
        even(sy(seated.y)),
        seated.look,
        seated.pose,
        seated.frame,
      );
      drawHealthBars(
        screen,
        slot.x + SEAT_DESK_DX,
        y + SEAT_BAR_DY,
        DESK_W,
        seated.activity.contextPct,
        seated.activity.usagePct,
      );
      drawSubAgents(screen, slot.x, y, seated);
    }
  }
}

/** Mini figures either side of the monitor, one per live sub-agent. */
function drawSubAgents(screen: Screen, slotX: number, slotY: number, parent: Character): void {
  const count = Math.min(2, parent.activity.subagents);
  const slots = [slotX + 2, slotX + 12];
  for (let i = 0; i < count; i++) {
    drawSubAgent(screen, slots[i], slotY + SEAT_DESK_DY + 1, parent.look, parent.frame + i * 7);
  }
}

/** The common area: rug, sofa, coffee table, bench, coffee machine. */
function drawLounge(screen: Screen, view: OfficeView, sy: (y: number) => number): void {
  const f = loungeFurniture(view.room);
  const rugY = sy(f.rug.y);
  if (rugY > view.bottom || rugY + f.rug.h < view.top) return;

  screen.fillRect(f.rug.x, rugY, f.rug.w, f.rug.h, PALETTE.rug);
  screen.strokeRect(f.rug.x, rugY, f.rug.w, f.rug.h, PALETTE.rugAccent);
  screen.strokeRect(f.rug.x + 2, rugY + 2, f.rug.w - 4, f.rug.h - 4, PALETTE.rugAccent);

  drawSofa(screen, f.sofa.x, sy(f.sofa.y), f.sofa.w, f.sofa.h);
  drawCoffeeTable(screen, f.table.x, sy(f.table.y), f.table.w, f.table.h);
  drawBench(screen, f.bench.x, sy(f.bench.y), f.bench.w, f.bench.h);
  drawCoffeeMachine(screen, f.coffee.x, sy(f.coffee.y), f.coffee.w, f.coffee.h);

  // A table only animates while two people are actually stood at it. Checking
  // the activity alone is not enough: someone can hold the activity while
  // walking, or be pulled away by a relayout.
  const playersAt = (kind: string, table: { x: number; y: number; w: number; h: number }) =>
    view.characters.filter(
      (c) =>
        c.social.kind === kind &&
        c.phase !== "walking" &&
        c.y > table.y - 10 &&
        c.y < table.y + table.h + 8 &&
        c.x > table.x - 10 &&
        c.x < table.x + table.w + 10,
    ).length;
  const ballT = playersAt("pingPong", f.pingPong) >= 2 ? (Math.sin(view.tick / 7) + 1) / 2 : null;
  drawPingPongTable(
    screen,
    { x: f.pingPong.x, y: sy(f.pingPong.y), w: f.pingPong.w, h: f.pingPong.h },
    ballT,
  );
  drawPoolTable(
    screen,
    { x: f.pool.x, y: sy(f.pool.y), w: f.pool.w, h: f.pool.h },
    view.tick,
    playersAt("pool", f.pool) >= 2,
  );
  drawFoosball(
    screen,
    { x: f.foosball.x, y: sy(f.foosball.y), w: f.foosball.w, h: f.foosball.h },
    view.tick,
    playersAt("foosball", f.foosball) >= 2,
  );
  drawDiningTable(screen, {
    x: f.dining.x,
    y: sy(f.dining.y),
    w: f.dining.w,
    h: f.dining.h,
  });
  drawCocktailBar(
    screen,
    { x: f.cocktail.x, y: sy(f.cocktail.y), w: f.cocktail.w, h: f.cocktail.h },
    view.tick,
  );
  // The bartender is always on duty: a bar nobody is working reads as closed.
  drawBartender(screen, f.bartender.x, sy(f.bartender.y), view.tick);
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

function drawCharacter(
  screen: Screen,
  view: OfficeView,
  character: Character,
  sy: (y: number) => number,
  hits: HitBox[],
): void {
  const x = even(character.x);
  const y = even(sy(character.y));
  if (y + STANDING_H < view.top || y > view.bottom) return;

  // Walking, or paused mid-roam away from its seat: either way, on its feet.
  if (character.phase === "walking" || character.roamingAway) {
    const moving = character.phase === "walking";
    drawStanding(screen, x, y, character.look, character.facing, character.frame, moving);
    drawProps(screen, view, character, x, y);
    pushHit(hits, character.id, x, y, x + CHAR_W, y + STANDING_H);
    bubbleFor(screen, character, x, y - 1);
    drawSpeech(screen, view, character, x, y - 1);
    if (isMarked(view, character.id)) drawSelection(screen, x, y, CHAR_W, STANDING_H);
    return;
  }

  if (character.spot.zone === "desk") {
    // The body was already drawn behind the desk by drawDeskBank.
    const slot = view.room.desks[deskIndexOf(character)];
    const slotY = slot ? sy(slot.y) : y;
    pushHit(
      hits,
      character.id,
      (slot?.x ?? x) + SEAT_DESK_DX,
      y,
      (slot?.x ?? x) + SEAT_DESK_DX + DESK_W,
      slotY + SEAT_DESK_DY + SEAT_DESK_H,
    );
    if (isMarked(view, character.id)) {
      drawSelection(screen, x, seatedBodyY(y, character.pose), CHAR_W, SEATED_H);
    }
    bubbleFor(screen, character, x, seatedBodyY(y, character.pose) - 1);
    return;
  }

  if (character.spot.pose === "stand") {
    drawStanding(screen, x, y, character.look, "down", character.frame, false);
    drawProps(screen, view, character, x, y);
    pushHit(hits, character.id, x, y, x + CHAR_W, y + STANDING_H);
  } else {
    drawLoungeSitter(screen, x, y, character.look);
    pushHit(hits, character.id, x, y, x + CHAR_W, y + SEATED_H);
  }
  if (isMarked(view, character.id)) drawSelection(screen, x, y, CHAR_W, SEATED_H);
  bubbleFor(screen, character, x, y - 1);
  drawSpeech(screen, view, character, x, y - 1);
}

function idParity(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 2;
}

/**
 * Sprites must land on the cell grid or the authored two-colours-per-cell
 * budget is broken by the straddle, not by the art.
 */
function even(value: number): number {
  return Math.round(value) & ~1;
}

function isMarked(view: OfficeView, id: string): boolean {
  return view.selectedId === id || view.hoverId === id;
}

function deskIndexOf(character: Character): number {
  const raw = character.spot.id.split(":")[1];
  const index = Number(raw);
  return Number.isFinite(index) ? index : -1;
}

/** Trailing index of a spot id ("lounge:sofa:1" -> 1), used to stagger tags. */
function spotIndexOf(character: Character): number {
  const parts = character.spot.id.split(":");
  const index = Number(parts[parts.length - 1]);
  return Number.isFinite(index) ? index : 0;
}

function nearTable(c: Character, t: { x: number; y: number; w: number; h: number }): boolean {
  return c.y > t.y - 10 && c.y < t.y + t.h + 8 && c.x > t.x - 10 && c.x < t.x + t.w + 10;
}

/** Paddle, cue and coffee cup, held by whoever is using them. */
function drawProps(
  screen: Screen,
  view: OfficeView,
  character: Character,
  x: number,
  y: number,
): void {
  const social = character.social;
  const f = view.room.furniture;

  if (social.kind === "foosball" && character.phase !== "walking" && nearTable(character, f.foosball)) {
    // Hands on the rods; no prop to hold.
  } else if (social.kind === "pingPong" && character.phase !== "walking" && nearTable(character, f.pingPong)) {
    const facing = character.x < f.pingPong.x ? "right" : "left";
    const hand = facing === "right" ? x + CHAR_W - 1 : x;
    drawPaddle(screen, hand, y + 6, facing, Math.floor(view.tick / 7) % 2 === social.side);
  } else if (social.kind === "pool" && character.phase !== "walking" && nearTable(character, f.pool)) {
    const facing = character.x < f.pool.x ? "right" : "left";
    const hand = facing === "right" ? x + CHAR_W - 1 : x;
    drawCue(screen, hand, y + 6, facing, Math.floor(view.tick / 18) % 2 === 0);
  }

  if (social.cup) {
    // A cocktail is not a coffee.
    if (social.kind === "cocktail") drawGlass(screen, x + CHAR_W - 1, y + 8);
    else drawCup(screen, x + CHAR_W - 1, y + 8);
  }
}

/**
 * A spoken line above a character. One text cell is 1px wide and 2px tall, so
 * an N-character line needs an N+2 pixel box — which makes text bubbles cheap
 * here in a way they would not be in a normal pixel grid.
 */
function drawSpeech(
  screen: Screen,
  view: OfficeView,
  character: Character,
  x: number,
  bottomY: number,
): void {
  const line = character.social.say;
  if (!line) return;

  // The box is measured in subpixels; the line inside it is measured in cells.
  const cells = Math.min(line.length + 2, screen.cols - 2);
  const w = cells * SUB_X;
  const h = 6;
  // Snap to an even pixel row so the text lands on a cell boundary.
  let top = (bottomY - h) & ~1;
  // Near the top of the viewport there is no room overhead, so flip the bubble
  // under the speaker rather than letting it clip away silently.
  if (top < view.top + 2) top = (bottomY + STANDING_H + 2) & ~1;
  if (top + h < view.top || top + h > view.bottom) return;

  const bx = Math.max(
    0,
    Math.min(screen.pxW - w, x + Math.floor(CHAR_W / 2) - Math.floor(w / 2)),
  );
  screen.fillRect(bx, top, w, h - 1, PALETTE.speechBg);
  screen.strokeRect(bx, top, w, h - 1, PALETTE.speechEdge);
  // Tail pointing down at the speaker.
  screen.setPixel(bx + Math.floor(w / 2), top + h - 1, PALETTE.speechBg);

  const row = (top + 2) / 2;
  if (row >= Math.floor(view.top / 2) && row < Math.floor(view.bottom / 2)) {
    screen.putTextCentered(
      Math.round(bx / SUB_X),
      row,
      cells,
      truncate(line, cells - 2),
      PALETTE.speechInk,
      PALETTE.speechBg,
    );
  }
}

function bubbleFor(screen: Screen, character: Character, x: number, bottomY: number): void {
  const bubble = character.bubble;
  if (!bubble) return;
  drawBubble(
    screen,
    x + Math.floor(CHAR_W / 2),
    bottomY,
    bubble.kind,
    character.frame,
    bubble.alpha,
  );
}

function pushHit(hits: HitBox[], id: string, x0: number, y0: number, x1: number, y1: number): void {
  hits.push({ id, x0, y0, x1, y1 });
}

/* ------------------------------------------------------------------ */
/* Labels and hints                                                    */
/* ------------------------------------------------------------------ */

function drawNameTag(
  screen: Screen,
  view: OfficeView,
  character: Character,
  sy: (y: number) => number,
): void {
  if (character.phase === "walking") return;
  // A speech bubble occupies the same band as the tag; the line is the more
  // interesting of the two, so the name steps aside while someone is talking.
  if (character.social.say) return;

  // Both zones stagger their tags onto two rows, for the same reason: a tag is
  // wider than the space one character occupies. Desks alternate by column,
  // which buys each tag two slots of width — at 12 columns a single-row desk
  // tag truncates to "Running: c…", which says nothing. Lounge sitters are only
  // a few pixels apart, so they alternate by identity.
  const atDesk = character.spot.zone === "desk" && character.atSpot;
  const slot = atDesk ? view.room.desks[deskIndexOf(character)] : undefined;

  let labelPxY: number;
  let width: number;
  let left: number;

  if (atDesk && slot) {
    const column = slot.index % Math.max(1, view.room.deskColumns);
    width = DESK_SLOT_W * 2 - 1;
    labelPxY = sy(slot.y) + SEAT_LABEL_DY + (column % 2 === 1 ? 2 : 0);
    // A tag is wider than its slot, so the end columns would hang off the room
    // and get clipped by the screen edge - which eats the front of the text and
    // leaves "efactor payment appr...". Keep the band inside the desk area.
    const area = view.room.deskArea;
    left = clamp(
      slot.x - Math.floor((width - DESK_SLOT_W) / 2),
      area.x,
      Math.max(area.x, area.x + area.w - width),
    );
  } else {
    const parity = character.roamingAway ? idParity(character.id) : spotIndexOf(character);
    width = DESK_SLOT_W - 2;
    labelPxY = sy(character.y) + SEATED_H + 2 + (parity % 2 === 1 ? 2 : 0);
    left = Math.round(character.x) - 3;
  }

  if (labelPxY < view.top || labelPxY + 1 >= view.bottom) return;
  const row = Math.floor(labelPxY / 2);
  if (row < Math.floor(view.top / 2) || row >= Math.floor(view.bottom / 2)) return;

  const selected = view.selectedId === character.id;
  const busy = character.snapshot.status === "working" || character.snapshot.status === "blocked";
  const status =
    atDesk && busy && character.activity.label
      ? PALETTE.text
      : STATUS_COLOR[character.snapshot.status] ?? PALETTE.textDim;
  const badge = character.isTeammate ? "▸" : "";
  // Budget in cells, not pixels: desk tags are two slots wide and sit two slots
  // apart, so a tag filling its band edge-to-edge touches its neighbour and the
  // two labels read as one word ("...payment apAudit auth..."). Leave a cell
  // either side.
  const cells = Math.round(width / SUB_X);
  const text = truncate(
    badge + (atDesk ? character.tagText : character.displayName),
    Math.max(1, cells - 2),
  );
  screen.putTextCentered(
    Math.round(left / SUB_X),
    row,
    cells,
    text,
    selected ? PALETTE.textBright : status,
    PALETTE.panelAlt,
  );
}

/**
 * Detail panel for the character under the cursor: the things that do not fit
 * on a 14-column name tag.
 */
function drawTooltip(screen: Screen, view: OfficeView): void {
  if (!view.hoverId) return;
  const character = view.characters.find((c) => c.id === view.hoverId);
  if (!character) return;

  const activity = character.activity;
  const lines = [
    character.displayName,
    `${character.snapshot.status}${character.isTeammate ? " · teammate" : ""}`,
    activity.label ?? activity.detail ?? "—",
    `${character.snapshot.agent ?? "?"} · ${character.snapshot.workspaceId} · ${
      character.snapshot.cwd ? path.basename(character.snapshot.cwd) : "?"
    }`,
  ];
  if (activity.contextPct !== null || activity.usagePct !== null) {
    lines.push(`ctx ${activity.contextPct ?? "--"}%  use ${activity.usagePct ?? "--"}%`);
  }

  const width = Math.min(
    Math.max(...lines.map((l) => l.length)) + 2,
    Math.max(12, screen.cols - 2),
  );
  // Anchor near the character, then clamp so the panel never leaves the pane.
  const anchorRow = Math.floor((Math.round(character.y) - view.camera + view.top) / 2);
  const col = Math.max(
    0,
    Math.min(screen.cols - width, Math.round(character.x / SUB_X) - 2),
  );
  const topRow = Math.max(
    Math.floor(view.top / 2),
    Math.min(Math.floor(view.bottom / 2) - lines.length, anchorRow - lines.length),
  );

  for (let i = 0; i < lines.length; i++) {
    const row = topRow + i;
    if (row < 0 || row >= screen.rows) continue;
    const fg = i === 0 ? PALETTE.textBright : PALETTE.textDim;
    screen.putText(col, row, ` ${truncate(lines[i], width - 2)} `.padEnd(width), fg, PALETTE.panel);
  }
}

/**
 * Tells you there are people outside the viewport. Without it a tall room just
 * looks like it is missing agents the status bar says exist.
 */
function drawScrollHint(screen: Screen, view: OfficeView): void {
  const viewportPx = view.bottom - view.top;
  let above = 0;
  let below = 0;
  for (const character of view.characters) {
    const top = character.y;
    if (top < view.camera) above++;
    else if (top + SEATED_H + 4 > view.camera + viewportPx) below++;
  }
  if (above === 0 && below === 0) return;

  const parts: string[] = [];
  if (above > 0) parts.push(`▴ ${above}`);
  if (below > 0) parts.push(`▾ ${below}`);
  const text = ` ${parts.join("  ")} `;
  const row = Math.floor((view.bottom - 1) / 2);
  screen.putText(
    Math.max(0, screen.cols - text.length - 1),
    row,
    text,
    PALETTE.textDim,
    PALETTE.panel,
  );
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
