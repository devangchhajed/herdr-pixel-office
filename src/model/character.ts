import { Activity, emptyActivity } from "../activity";
import { AgentSnapshot, AgentStatus } from "../herdr";
import { CharacterLook, Facing, SeatedPose, lookFor } from "../render/sprites";
import { Point } from "./navmesh";
import { Social, idleSocial } from "./social";
import { Spot, Zone } from "./office";

export type BubbleKind = "waiting" | "question" | "done";

/** How long a finished-turn checkmark lingers before fading, in ticks (~12/s). */
const DONE_BUBBLE_TICKS = 36;
const WALK_SPEED = 0.9;
/** Idle characters pause this long (ticks, ~12/s) between wander moves. */
const WANDER_PAUSE_MIN = 40;
const WANDER_PAUSE_MAX = 130;
const WANDER_MOVES_MIN = 2;
const WANDER_MOVES_MAX = 5;

export type Phase = "walking" | "settled";

/** Where an agent belongs right now: working at a desk, or not working at all. */
export function zoneForStatus(status: AgentStatus): Zone {
  return status === "working" || status === "blocked" ? "desk" : "lounge";
}

/**
 * One agent's character. Position is tracked in room pixel space so characters
 * can walk between the desk bank and the common area when their status changes.
 */
export class Character {
  readonly id: string;
  readonly look: CharacterLook;
  snapshot: AgentSnapshot;
  spot: Spot;
  /** Scraped from the pane; drives the label, read-vs-type pose and gauges. */
  activity: Activity = emptyActivity();
  /** Purely cosmetic break-room behaviour; cleared the moment work arrives. */
  social: Social = idleSocial();

  x: number;
  y: number;
  phase: Phase = "walking";
  facing: Facing = "right";
  frame = 0;


  private path: Point[] = [];
  /** Set while the character is off wandering rather than heading to its spot. */
  private roaming = false;
  wanderTimer = randomInt(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
  wanderCount = 0;
  wanderLimit = randomInt(WANDER_MOVES_MIN, WANDER_MOVES_MAX);

  private bubbleKind: BubbleKind | null = null;
  private bubbleAlpha = 0;
  private doneTicks = 0;
  private lastStatus: AgentStatus;

  constructor(snapshot: AgentSnapshot, spot: Spot, doorY: number) {
    this.id = snapshot.paneId;
    this.snapshot = snapshot;
    this.look = lookFor(snapshot.paneId + (snapshot.agent ?? ""));
    this.spot = spot;
    this.lastStatus = snapshot.status;
    // Walk in through the door on the left wall.
    this.x = -8;
    this.y = doorY;
    this.path = [{ x: spot.x, y: spot.y }];
  }

  get zone(): Zone {
    return this.spot.zone;
  }

  /** Snaps straight onto the spot; used when the room is relaid out on resize. */
  placeAtSpot(): void {
    this.x = this.spot.x;
    this.y = this.spot.y;
    this.path = [];
    this.phase = "settled";
    this.roaming = false;
  }

  update(snapshot: AgentSnapshot): void {
    if (snapshot.status !== this.lastStatus) {
      this.onStatusChange(snapshot.status);
      this.lastStatus = snapshot.status;
    }
    this.snapshot = snapshot;
  }

  /** Drops any break-room activity: work takes priority over table tennis. */
  clearSocial(): void {
    const cup = this.social.cup;
    this.social = idleSocial();
    this.social.cup = cup;
  }

  says(line: string, ticks: number): void {
    this.social.say = line || null;
    this.social.sayTimer = line ? ticks : 0;
  }

  private onStatusChange(next: AgentStatus): void {
    if (next === "done") {
      this.bubbleKind = "done";
      this.bubbleAlpha = 1;
      this.doneTicks = DONE_BUBBLE_TICKS;
    } else if (next === "blocked") {
      this.bubbleKind = this.blockedBubble();
      this.bubbleAlpha = 1;
    } else {
      this.bubbleKind = null;
    }
  }

  /** A permission ask and a question look different, as in pixel-agents. */
  private blockedBubble(): BubbleKind {
    return this.activity.blockedKind === "input" ? "question" : "waiting";
  }

  /** Sends the character to a spot along a path the caller computed. */
  moveTo(spot: Spot, path: Point[]): void {
    const sameSpot = spot.id === this.spot.id && spot.x === this.spot.x && spot.y === this.spot.y;
    if (sameSpot && this.phase === "settled" && this.atSpot) return;
    this.spot = spot;
    this.phase = "walking";
    this.roaming = false;
    this.path = path.length > 0 ? path : [{ x: spot.x, y: spot.y }];
  }

  /** Sends the character off to roam; it is not heading for its spot. */
  wanderTo(path: Point[]): void {
    if (path.length === 0) return;
    this.phase = "walking";
    this.roaming = true;
    this.path = path;
  }

  resetWanderTimer(): void {
    this.wanderTimer = randomInt(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
  }

  /** True when the character is standing on its assigned spot. */
  get atSpot(): boolean {
    return Math.abs(this.x - this.spot.x) < 1 && Math.abs(this.y - this.spot.y) < 1;
  }

  /** Standing around away from its seat: mid-roam, or paused somewhere. */
  get roamingAway(): boolean {
    return this.roaming && !this.atSpot;
  }

  tick(): void {
    this.frame++;
    if (this.phase === "walking") this.stepAlongPath();

    if (this.social.sayTimer > 0 && --this.social.sayTimer === 0) this.social.say = null;

    // A blocked agent keeps its bubble until you deal with it; a finished turn
    // announces itself and then gets out of the way.
    if (this.snapshot.status === "blocked") {
      this.bubbleKind = this.blockedBubble();
      this.bubbleAlpha = Math.min(1, this.bubbleAlpha + 0.15);
    } else if (this.bubbleKind === "done") {
      if (this.doneTicks > 0) this.doneTicks--;
      else this.bubbleAlpha = Math.max(0, this.bubbleAlpha - 0.06);
      if (this.bubbleAlpha <= 0) this.bubbleKind = null;
    } else if (this.bubbleKind === "waiting" || this.bubbleKind === "question") {
      this.bubbleAlpha = Math.max(0, this.bubbleAlpha - 0.12);
      if (this.bubbleAlpha <= 0) this.bubbleKind = null;
    }
  }

  private stepAlongPath(): void {
    const target = this.path[0];
    if (!target) {
      this.phase = "settled";
      this.facing = "down";
      return;
    }

    const dx = target.x - this.x;
    const dy = target.y - this.y;

    if (Math.abs(dx) > WALK_SPEED) {
      this.x += Math.sign(dx) * WALK_SPEED;
      this.facing = dx > 0 ? "right" : "left";
      return;
    }
    this.x = target.x;

    if (Math.abs(dy) > WALK_SPEED) {
      this.y += Math.sign(dy) * WALK_SPEED;
      this.facing = dy > 0 ? "down" : "up";
      return;
    }
    this.y = target.y;
    this.path.shift();
    if (this.path.length === 0) {
      this.phase = "settled";
      this.facing = "down";
    }
  }

  get bubble(): { kind: BubbleKind; alpha: number } | null {
    if (!this.bubbleKind || this.bubbleAlpha <= 0) return null;
    return { kind: this.bubbleKind, alpha: this.bubbleAlpha };
  }

  /** True when the character is sitting rather than standing about. */
  get seated(): boolean {
    return this.phase === "settled" && this.atSpot && this.spot.pose !== "stand";
  }

  /** Body pose once settled at a desk. */
  get pose(): SeatedPose {
    switch (this.snapshot.status) {
      case "working":
        return this.activity.kind === "reading" ? "read" : "type";
      case "blocked":
        return "raise";
      case "done":
        return "lean";
      default:
        return "idle";
    }
  }

  /** How brightly the desk monitor glows, 0..1. */
  get screenLit(): number {
    switch (this.snapshot.status) {
      case "working":
        // Gentle flicker while the agent is actually doing something.
        return 0.75 + 0.25 * Math.sin(this.frame / 3);
      case "blocked":
        return 0.85;
      case "done":
        return 0.5;
      case "idle":
        return 0.3;
      default:
        return 0.12;
    }
  }

  /**
   * A named herdr agent is a teammate — something spawned deliberately rather
   * than a plain session. herdr does not expose which agent is its lead, so the
   * office can mark teammates and group them, but not draw the team itself.
   */
  get isTeammate(): boolean {
    return this.snapshot.name !== null;
  }

  /** What the tag under the desk says: the live activity while working. */
  get tagText(): string {
    const status = this.snapshot.status;
    if ((status === "working" || status === "blocked") && this.activity.label) {
      return this.activity.label;
    }
    return this.displayName;
  }

  get displayName(): string {
    const label = this.snapshot.label.trim();
    if (label) return label;
    return this.snapshot.agent ?? this.snapshot.paneId;
  }
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
