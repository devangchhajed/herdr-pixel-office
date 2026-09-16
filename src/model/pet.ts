import { NavGrid, Point } from "./navmesh";
import { Rect } from "./office";

const PAUSE_MIN = 30;
const PAUSE_MAX = 120;
const SPEED = 0.5;

/**
 * An office cat. Not an agent: it has no session, takes no seat, and exists
 * purely so the common area has something moving in it.
 */
export class Pet {
  x = 0;
  y = 0;
  frame = 0;
  facing: "left" | "right" = "right";
  /** Counts down while the pet is happy after being clicked. */
  happy = 0;

  private path: Point[] = [];
  private timer = randomInt(PAUSE_MIN, PAUSE_MAX);

  constructor(start: Point) {
    this.x = start.x;
    this.y = start.y;
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  tick(nav: NavGrid, area: Rect): void {
    this.frame++;
    if (this.happy > 0) this.happy--;

    if (this.path.length > 0) {
      this.step();
      return;
    }
    if (--this.timer > 0) return;
    this.timer = randomInt(PAUSE_MIN, PAUSE_MAX);

    const target = nav.randomWalkableIn(area, Math.random);
    if (!target) return;
    this.path = nav.findPath({ x: this.x, y: this.y }, target);
  }

  private step(): void {
    const target = this.path[0];
    if (!target) return;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (Math.abs(dx) > SPEED) {
      this.x += Math.sign(dx) * SPEED;
      this.facing = dx > 0 ? "right" : "left";
      return;
    }
    this.x = target.x;
    if (Math.abs(dy) > SPEED) {
      this.y += Math.sign(dy) * SPEED;
      return;
    }
    this.y = target.y;
    this.path.shift();
  }

  pet(): void {
    this.happy = 36;
    this.path = [];
  }
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
