import {
  DESK_SLOT_W,
  Rect,
  Room,
  SEAT_DESK_DX,
  SEAT_DESK_DY,
  SEAT_DESK_H,
  loungeFurniture,
} from "./office";

/** Collision is tracked on a coarse grid; 4px keeps it cheap and accurate enough. */
export const TILE = 4;

/** Character body offsets used to turn a body position into the point that walks. */
export const FOOT_DX = 5;
export const FOOT_DY = 10;

export interface Point {
  x: number;
  y: number;
}

/**
 * Walkability for the room, so characters path around furniture instead of
 * strolling through a desk. Seats are deliberately *not* walkable, but they are
 * accepted as a path destination — the same exception pixel-agents makes for
 * chair tiles.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;

  constructor(room: Room) {
    this.cols = Math.max(1, Math.ceil(room.width / TILE));
    this.rows = Math.max(1, Math.ceil(room.contentHeight / TILE));
    this.blocked = new Uint8Array(this.cols * this.rows);

    // The wall, minus the doorway characters enter through.
    this.blockRect({ x: 0, y: 0, w: room.width, h: room.wallH });
    this.clearRect({ x: 3, y: 0, w: 16, h: room.wallH });

    for (const slot of room.desks) {
      this.blockRect({
        x: slot.x + SEAT_DESK_DX,
        y: slot.y + SEAT_DESK_DY,
        w: DESK_SLOT_W - 2,
        h: SEAT_DESK_H,
      });
    }

    const f = loungeFurniture(room);
    this.blockRect(f.sofa);
    this.blockRect(f.table);
    this.blockRect(f.bench);
    this.blockRect(f.coffee);
    this.blockRect(f.pingPong);
    this.blockRect(f.pool);
    this.blockRect(f.foosball);
    this.blockRect(f.cocktail);
    this.blockRect(f.dining);

    for (const item of room.decor) {
      if (item.kind === "painting" || item.kind === "clock") continue; // on the wall
      this.blockRect({ x: item.x, y: item.y, w: 8, h: 7 });
    }
  }

  private blockRect(r: Rect): void {
    this.forTiles(r, (i) => {
      this.blocked[i] = 1;
    });
  }

  private clearRect(r: Rect): void {
    this.forTiles(r, (i) => {
      this.blocked[i] = 0;
    });
  }

  private forTiles(r: Rect, fn: (index: number) => void): void {
    const c0 = Math.max(0, Math.floor(r.x / TILE));
    const r0 = Math.max(0, Math.floor(r.y / TILE));
    const c1 = Math.min(this.cols - 1, Math.floor((r.x + r.w - 1) / TILE));
    const r1 = Math.min(this.rows - 1, Math.floor((r.y + r.h - 1) / TILE));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) fn(row * this.cols + col);
    }
  }

  isWalkableTile(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
    return this.blocked[row * this.cols + col] === 0;
  }

  isWalkablePoint(p: Point): boolean {
    return this.isWalkableTile(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
  }

  /**
   * Breadth-first path between two foot positions, returned as pixel waypoints
   * with collinear steps collapsed so the walk reads as straight lines. The
   * destination may be blocked (a seat); intermediate tiles may not.
   */
  findPath(from: Point, to: Point): Point[] {
    const startC = clamp(Math.floor(from.x / TILE), 0, this.cols - 1);
    const startR = clamp(Math.floor(from.y / TILE), 0, this.rows - 1);
    const goalC = clamp(Math.floor(to.x / TILE), 0, this.cols - 1);
    const goalR = clamp(Math.floor(to.y / TILE), 0, this.rows - 1);
    const goal = goalR * this.cols + goalC;

    if (startC === goalC && startR === goalR) return [to];

    const prev = new Int32Array(this.cols * this.rows).fill(-1);
    const seen = new Uint8Array(this.cols * this.rows);
    const queue: number[] = [startR * this.cols + startC];
    seen[queue[0]] = 1;
    let found = false;

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current === goal) {
        found = true;
        break;
      }
      const col = current % this.cols;
      const row = (current - col) / this.cols;
      const neighbours = [
        [col + 1, row],
        [col - 1, row],
        [col, row + 1],
        [col, row - 1],
      ];
      for (const [nc, nr] of neighbours) {
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const index = nr * this.cols + nc;
        if (seen[index]) continue;
        // The goal tile is reachable even when blocked, so seats can be targets.
        if (!this.isWalkableTile(nc, nr) && index !== goal) continue;
        seen[index] = 1;
        prev[index] = current;
        queue.push(index);
      }
    }

    if (!found) return [to]; // no route: walk straight there rather than freeze

    const tiles: number[] = [];
    for (let at = goal; at !== -1; at = prev[at]) tiles.push(at);
    tiles.reverse();

    const points: Point[] = tiles.slice(1).map((index) => {
      const col = index % this.cols;
      const row = (index - col) / this.cols;
      return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
    });
    points[points.length - 1] = to; // land exactly on the seat
    return simplify(points);
  }

  /** A random walkable point inside `area`, or null if it is solid. */
  randomWalkableIn(area: Rect, pick: () => number): Point | null {
    const candidates: Point[] = [];
    const c0 = Math.max(0, Math.floor(area.x / TILE));
    const r0 = Math.max(0, Math.floor(area.y / TILE));
    const c1 = Math.min(this.cols - 1, Math.floor((area.x + area.w - 1) / TILE));
    const r1 = Math.min(this.rows - 1, Math.floor((area.y + area.h - 1) / TILE));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.isWalkableTile(col, row)) {
          candidates.push({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(pick() * candidates.length) % candidates.length];
  }
}

/** Drops waypoints that continue in the same direction. */
function simplify(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const straight = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!straight) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Body position → the point that actually walks (roughly the feet). */
export function footOf(bodyX: number, bodyY: number): Point {
  return { x: bodyX + FOOT_DX, y: bodyY + FOOT_DY };
}

/** Foot waypoint → body position. */
export function bodyOf(foot: Point): Point {
  return { x: foot.x - FOOT_DX, y: foot.y - FOOT_DY };
}
