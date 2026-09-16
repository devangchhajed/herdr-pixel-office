import * as path from "node:path";
import { Activity, emptyActivity, parseActivity } from "./activity";
import { AgentSnapshot, focusAgent } from "./herdr";
import { Character, zoneForStatus } from "./model/character";
import { NavGrid, Point, bodyOf, footOf } from "./model/navmesh";
import {
  DESK_SLOT_H,
  DESK_SLOT_W,
  OfficeArea,
  Room,
  Spot,
  deskColumnsFor,
  deskSpot,
  layoutRoom,
  loungeSpots,
} from "./model/office";
import { Pet } from "./model/pet";
import {
  CHAT_TICKS,
  COFFEE_TICKS,
  GAME_TICKS,
  coffeeLine,
  cocktailLine,
  randomLine,
  randomReply,
} from "./model/social";
import { PALETTE, areaTint } from "./render/palette";
import { loadState, saveState } from "./state";
import { SUB_X, SUB_Y, Screen } from "./render/screen";
import { CHAR_W } from "./render/sprites";
import { Tab, TabHit, renderStatusBar, renderTabs } from "./ui/chrome";
import { HitBox, renderOffice } from "./ui/office";
import { RosterHit, renderRoster, sortCharacters } from "./ui/roster";
import { renderSettings } from "./ui/settings";

export interface AppOptions {
  socketPath: string | null;
  demo: boolean;
}

const OFFICE_HINTS = "tab · home/end · n names · c clock · r reminder · enter focus · q";
const ROSTER_HINTS = "tab · ↑↓ select · enter focus · q quit";
const SETTINGS_HINTS = "tab screens · enter edit · q quit";
const MESSAGE_TICKS = 30;
/** How long into each hour the hydration reminder stays pinned up. */
const REMINDER_MINUTES = 2;
/** Half-period of the notice-board flash, in ticks (~12/s). */
const NOTICE_FLASH_TICKS = 6;
const TAB_ORDER: Tab[] = ["office", "roster", "settings"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** Working and blocked agents are scraped first; idle ones can wait. */
function rankForScrape(status: string): number {
  if (status === "working") return 0;
  if (status === "blocked") return 1;
  if (status === "done") return 2;
  return 3;
}

export class App {
  private characters = new Map<string, Character>();
  /** id -> desk index, so a working agent keeps its desk as others come and go. */
  private deskAssignment = new Map<string, number>();
  /** id -> lounge spot index, same idea for the common area. */
  private loungeAssignment = new Map<string, number>();
  private room: Room;
  private nav: NavGrid;
  private areas: OfficeArea[] = [];

  /** Always starts on the office; the screen you were last on is not restored. */
  private tab: Tab = "office";
  private selectedId: string | null = null;
  private showNames = true;
  private camera = 0;
  private rosterScroll = 0;

  /** Round-robin cursors for pane reads: one over everyone, one over the busy. */
  private activityCursor = 0;
  private busyCursor = 0;
  private scrapeBusyTurn = false;
  private connected = false;
  private message: string | null = null;
  private messageTicks = 0;

  private pet: Pet | null = null;
  private frameCount = 0;
  private sound = true;
  private chatter = false;
  private showClock = true;
  /** Pins the reminder on so it can be looked at outside the top of the hour. */
  private pinNotice = false;
  private companyName = "";
  private reminderOn = true;
  /** Live buffer while the company name is being edited; null when it is not. */
  private editing: string | null = null;
  private hoverId: string | null = null;
  private draggingId: string | null = null;
  private dragMoved = false;
  private tabHits: TabHit[] = [];
  private officeHits: HitBox[] = [];
  private rosterHits: RosterHit[] = [];

  constructor(
    private readonly screen: Screen,
    private readonly options: AppOptions,
  ) {
    this.room = layoutRoom(Math.max(screen.pxW, 1), 0, 0, this.showClock);
    this.nav = new NavGrid(this.room);

    const saved = loadState();
    if (saved.desks) for (const [id, i] of Object.entries(saved.desks)) this.deskAssignment.set(id, i);
    if (saved.lounge) for (const [id, i] of Object.entries(saved.lounge)) this.loungeAssignment.set(id, i);
    if (typeof saved.showNames === "boolean") this.showNames = saved.showNames;
    if (typeof saved.sound === "boolean") this.sound = saved.sound;
    if (typeof saved.chatter === "boolean") this.chatter = saved.chatter;
    if (typeof saved.showClock === "boolean") this.showClock = saved.showClock;
    if (typeof saved.companyName === "string") this.companyName = saved.companyName;
    if (typeof saved.reminderOn === "boolean") this.reminderOn = saved.reminderOn;
  }

  /** Called on exit; cheap enough to also call after a drag. */
  persist(): void {
    saveState({
      desks: Object.fromEntries(this.deskAssignment),
      lounge: Object.fromEntries(this.loungeAssignment),
      showNames: this.showNames,
      sound: this.sound,
      chatter: this.chatter,
      showClock: this.showClock,
      companyName: this.companyName,
      reminderOn: this.reminderOn,
    });
  }

  /** Walks a character to a body position, routing around furniture. */
  private pathTo(character: Character, target: Point): Point[] {
    const from = footOf(character.x, character.y);
    const to = footOf(target.x, target.y);
    return this.nav.findPath(from, to).map(bodyOf);
  }

  private viewportPx(): number {
    return Math.max(1, (this.screen.rows - 2) * 2);
  }

  get demo(): boolean {
    return this.options.demo;
  }

  /** Reconciles the live agent list into characters, seats and selection. */
  syncAgents(snapshots: AgentSnapshot[]): void {
    this.connected = true;
    const seen = new Set<string>();

    for (const snapshot of snapshots) {
      seen.add(snapshot.paneId);
      const existing = this.characters.get(snapshot.paneId);
      if (existing) {
        const wasBlocked = existing.snapshot.status === "blocked";
        existing.update(snapshot);
        if (!wasBlocked && snapshot.status === "blocked" && this.sound && process.stdout.isTTY) {
          process.stdout.write("\x07");
        }
        continue;
      }
      // Spot is corrected by assignSpots() immediately after; this is just a
      // starting point so the character exists to be placed.
      const placeholder: Spot = { id: "pending", zone: "lounge", pose: "stand", x: -8, y: this.room.doorY };
      this.characters.set(snapshot.paneId, new Character(snapshot, placeholder, this.room.doorY));
    }

    for (const id of [...this.characters.keys()]) {
      if (seen.has(id)) continue;
      this.characters.delete(id);
      this.deskAssignment.delete(id);
      this.loungeAssignment.delete(id);
      if (this.selectedId === id) this.selectedId = null;
    }

    this.relayout(false);
  }

  /**
   * Picks the next pane to scrape. Working and blocked agents are visited first
   * so the character you are watching has the freshest label.
   */
  nextActivityTarget(): string | null {
    const all = [...this.characters.values()];
    if (all.length === 0) return null;

    // Alternate between "anyone" and "someone busy". A single cursor over a
    // status-sorted list visits everyone at the same rate, which is not the
    // priority this is supposed to give the agent you are watching.
    const busy = all.filter((c) => rankForScrape(c.snapshot.status) <= 1).map((c) => c.id);
    this.scrapeBusyTurn = !this.scrapeBusyTurn;
    if (this.scrapeBusyTurn && busy.length > 0) {
      this.busyCursor = (this.busyCursor + 1) % busy.length;
      return busy[this.busyCursor];
    }
    this.activityCursor = (this.activityCursor + 1) % all.length;
    return all[this.activityCursor].id;
  }

  applyPaneText(paneId: string, text: string): void {
    const character = this.characters.get(paneId);
    if (!character) return;
    character.activity = text ? parseActivity(text) : emptyActivity();
  }

  /** Demo mode feeds synthetic activity so the office looks the same offline. */
  setActivity(paneId: string, activity: Activity): void {
    const character = this.characters.get(paneId);
    if (character) character.activity = activity;
  }

  setDisconnected(err: Error): void {
    this.connected = false;
    this.notify(`herdr: ${err.message}`);
  }

  /**
   * Sends every agent to the zone its status implies: working and blocked
   * agents take a desk, everyone else goes to the common area. Assignments are
   * sticky, so an agent keeps its desk across polls and only walks when its
   * status actually moves it to the other zone.
   */
  private assignSpots(snap: boolean): void {
    const deskIds: string[] = [];
    const loungeIds: string[] = [];
    for (const [id, character] of this.characters) {
      if (zoneForStatus(character.snapshot.status) === "desk") deskIds.push(id);
      else loungeIds.push(id);
    }

    // Release assignments that no longer apply before handing out new ones.
    for (const id of loungeIds) this.deskAssignment.delete(id);
    for (const id of deskIds) this.loungeAssignment.delete(id);

    // Each workspace claims a band of whole desk rows, so the office reads as
    // one area per project rather than an interleaved jumble.
    const columns = deskColumnsFor(this.screen.pxW);
    const groups = new Map<string, string[]>();
    for (const id of deskIds) {
      const ws = this.characters.get(id)?.snapshot.workspaceId ?? "?";
      const list = groups.get(ws);
      if (list) list.push(id);
      else groups.set(ws, [id]);
    }

    this.areas = [];
    const ranges = new Map<string, { start: number; end: number }>();
    let row = 0;
    for (const ws of [...groups.keys()].sort()) {
      const members = groups.get(ws) ?? [];
      const rows = Math.max(1, Math.ceil(members.length / columns));
      const start = row * columns;
      const end = (row + rows) * columns;
      ranges.set(ws, { start, end });
      this.areas.push({
        label: this.areaLabel(ws, members),
        color: areaTint(ws),
        deskStart: start,
        deskEnd: end,
      });
      row += rows;
    }

    this.room = layoutRoom(
      Math.max(this.screen.pxW, 1),
      Math.max(row * columns, deskIds.length),
      loungeIds.length,
      this.showClock,
    );
    this.nav = new NavGrid(this.room);
    if (!this.pet) {
      const spawn = this.nav.randomWalkableIn(this.room.lounge, Math.random);
      if (spawn) this.pet = new Pet(spawn);
    }

    // Assignment stays sticky *within* a workspace band, so an agent only moves
    // desks when its own area is resized.
    const takenDesks = new Set<number>();
    for (const id of deskIds) {
      const ws = this.characters.get(id)?.snapshot.workspaceId ?? "?";
      const range = ranges.get(ws);
      const current = this.deskAssignment.get(id);
      if (range && current !== undefined && current >= range.start && current < range.end) {
        takenDesks.add(current);
      } else {
        this.deskAssignment.delete(id);
      }
    }
    // Teammates (named agents) take the front desks of their area so a team
    // sits together, as close as herdr's data allows.
    const unassigned = deskIds
      .filter((id) => !this.deskAssignment.has(id))
      .sort((a, b) => {
        const an = this.characters.get(a)?.isTeammate ? 0 : 1;
        const bn = this.characters.get(b)?.isTeammate ? 0 : 1;
        return an - bn || a.localeCompare(b);
      });
    for (const id of unassigned) {
      const ws = this.characters.get(id)?.snapshot.workspaceId ?? "?";
      const range = ranges.get(ws) ?? { start: 0, end: Number.MAX_SAFE_INTEGER };
      let index = range.start;
      while (takenDesks.has(index)) index++;
      takenDesks.add(index);
      this.deskAssignment.set(id, index);
    }

    const spots = loungeSpots(this.room, loungeIds.length);
    const takenLounge = new Set(
      [...this.loungeAssignment.entries()]
        .filter(([id]) => loungeIds.includes(id))
        .map(([, i]) => i),
    );
    for (const id of loungeIds) {
      const current = this.loungeAssignment.get(id);
      if (current !== undefined && current < spots.length) continue;
      let index = 0;
      while (takenLounge.has(index)) index++;
      takenLounge.add(index);
      this.loungeAssignment.set(id, index);
    }

    for (const [id, character] of this.characters) {
      const spot = this.spotFor(id, spots);
      if (!spot) continue;
      if (snap) {
        character.spot = spot;
        character.placeAtSpot();
        continue;
      }
      // Someone mid-activity is standing at a table or in a conversation, not on
      // their seat. Re-pathing them here (this runs on every poll) would walk
      // them away while the activity carried on without them — which is what
      // left the ping-pong ball rallying at an empty table. Record the seat so
      // they have somewhere to return to, but leave them where they are.
      if (character.social.kind !== "none") {
        character.spot = spot;
        continue;
      }
      character.moveTo(spot, this.pathTo(character, { x: spot.x, y: spot.y }));
    }
    this.clampCamera();
  }

  /**
   * Names an area after the project its agents are working in rather than the
   * bare workspace id: "api" says more than "w4". Falls back to the id when
   * the agents disagree or report no cwd.
   */
  private areaLabel(workspaceId: string, members: string[]): string {
    const counts = new Map<string, number>();
    for (const id of members) {
      const cwd = this.characters.get(id)?.snapshot.cwd;
      if (!cwd) continue;
      const project = path.basename(cwd);
      if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [project, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = project;
      }
    }
    return best ? `${best} ${workspaceId}` : workspaceId;
  }

  private spotFor(id: string, spots: Spot[]): Spot | null {
    const deskIndex = this.deskAssignment.get(id);
    if (deskIndex !== undefined) {
      const slot = this.room.desks[deskIndex];
      return slot ? deskSpot(slot) : null;
    }
    const loungeIndex = this.loungeAssignment.get(id);
    if (loungeIndex !== undefined) return spots[loungeIndex] ?? spots[spots.length - 1] ?? null;
    return null;
  }

  private relayout(snap: boolean): void {
    this.assignSpots(snap);
  }

  onResize(): void {
    this.relayout(true);
    this.screen.invalidate();
  }

  tick(): void {
    this.frameCount++;
    for (const character of this.characters.values()) character.tick();
    this.updateWander();
    this.pet?.tick(this.nav, this.room.lounge);
    if (this.messageTicks > 0) {
      this.messageTicks--;
      if (this.messageTicks === 0) this.message = null;
    }
    this.followSelection();
  }

  /** True when a character is free to be pulled into a break-room activity. */
  private isFree(character: Character): boolean {
    if (character.spot.zone !== "lounge") return false;
    if (character.phase === "walking") return false;
    const status = character.snapshot.status;
    if (status === "working" || status === "blocked") return false;
    return character.social.kind === "none";
  }

  /**
   * Runs the break room: people who have nothing to do pair off for a chat or a
   * game, fetch a coffee, or just wander. Purely cosmetic — a status change
   * cancels whatever they were doing and sends them back to a desk.
   */
  private updateWander(): void {
    // Work always wins: drop activities the moment an agent is busy again.
    for (const character of this.characters.values()) {
      const status = character.snapshot.status;
      const busy = status === "working" || status === "blocked";
      if ((busy || character.spot.zone !== "lounge") && character.social.kind !== "none") {
        this.endActivity(character);
      }
    }

    this.tickActivities();
    this.startActivities();

    for (const character of this.characters.values()) {
      if (!this.isFree(character)) continue;

      character.wanderTimer--;
      if (character.wanderTimer > 0) continue;
      character.resetWanderTimer();

      if (character.wanderCount >= character.wanderLimit) {
        character.wanderCount = 0;
        character.moveTo(character.spot, this.pathTo(character, character.spot));
        continue;
      }

      const target = this.nav.randomWalkableIn(this.room.lounge, Math.random);
      if (!target) continue;
      character.wanderTo(this.pathTo(character, bodyOf(target)));
      character.wanderCount++;
    }
  }

  /** Counts activities down and keeps conversations going back and forth. */
  private tickActivities(): void {
    for (const character of this.characters.values()) {
      const social = character.social;
      if (social.kind === "none") continue;

      if (--social.timer <= 0) {
        this.endActivity(character);
        continue;
      }

      const partner = social.partner ? this.characters.get(social.partner) : null;
      if (social.partner && (!partner || partner.social.partner !== character.id)) {
        // Partner left, went back to work, or was reassigned.
        this.endActivity(character);
        continue;
      }

      // Turn to face whatever they are doing, once they have stopped walking.
      if (character.phase !== "walking") {
        if (partner) {
          character.facing = character.x < partner.x ? "right" : "left";
        } else if (social.kind === "pingPong") {
          character.facing = character.x < this.room.furniture.pingPong.x ? "right" : "left";
        } else if (social.kind === "pool") {
          character.facing = character.x < this.room.furniture.pool.x ? "right" : "left";
        } else if (social.kind === "foosball") {
          character.facing = character.x < this.room.furniture.foosball.x ? "right" : "left";
        }
      }

      if (social.kind === "chat" && partner) {
        // Take turns: only the character without a live line speaks, and only
        // once its partner has finished saying theirs.
        if (!this.chatter) {
          // People still gather and face each other; they just do it quietly.
        } else if (!social.say && !partner.social.say && social.side === 0 && social.timer % 26 === 0) {
          character.says(randomLine(), 22);
          partner.social.side = 0;
          character.social.side = 1;
        } else if (!social.say && !partner.social.say && social.side === 1 && social.timer % 26 === 13) {
          character.says(randomReply(), 20);
          character.social.side = 0;
        }
      }

      const fetching = social.kind === "coffee" || social.kind === "cocktail";
      if (fetching && !social.cup && social.timer < COFFEE_TICKS - 30) {
        social.cup = true;
        if (this.chatter) {
          character.says(social.kind === "coffee" ? coffeeLine() : cocktailLine(), 22);
        }
      }
    }
  }

  private endActivity(character: Character): void {
    const partnerId = character.social.partner;
    character.clearSocial();
    if (!partnerId) return;
    const partner = this.characters.get(partnerId);
    if (partner && partner.social.partner === character.id) partner.clearSocial();
  }

  /** Occasionally starts something: a game, a coffee run, or a conversation. */
  private startActivities(): void {
    if (Math.random() > 0.04) return;

    const free = [...this.characters.values()].filter((c) => this.isFree(c));
    if (free.length === 0) return;

    const f = this.room.furniture;
    const busyAt = (kind: string) =>
      [...this.characters.values()].some((c) => c.social.kind === kind);

    // Games need two people and a free table.
    if (free.length >= 2) {
      for (const [kind, spots] of [
        ["pingPong", f.pingPongSpots],
        ["pool", f.poolSpots],
        ["foosball", f.foosballSpots],
      ] as const) {
        if (busyAt(kind)) continue;
        if (Math.random() > 0.5) continue;
        const [a, b] = free.splice(0, 2);
        this.pairUp(a, b, kind, GAME_TICKS, spots[0], spots[1]);
        return;
      }
    }

    // Solo trips: a coffee from the machine, or a drink at the counter.
    for (const [kind, spot] of [
      ["coffee", f.standSpots[0]],
      ["cocktail", f.cocktailSpots[0]],
    ] as const) {
      if (busyAt(kind) || !spot) continue;
      if (Math.random() > 0.4) continue;
      const character = free[0];
      character.social.kind = kind;
      character.social.timer = COFFEE_TICKS;
      character.wanderTo(this.pathTo(character, spot));
      return;
    }

    // Otherwise two people stand and talk wherever there is room.
    if (free.length >= 2) {
      const [a, b] = free;
      const spotA = { x: Math.round(b.x) - 11, y: Math.round(b.y) };
      const anchor = this.nav.isWalkablePoint(footOf(spotA.x, spotA.y))
        ? spotA
        : { x: Math.round(b.x) + 11, y: Math.round(b.y) };
      this.pairUp(a, b, "chat", CHAT_TICKS, anchor, { x: Math.round(b.x), y: Math.round(b.y) });
    }
  }

  private pairUp(
    a: Character,
    b: Character,
    kind: "chat" | "pingPong" | "pool" | "foosball",
    ticks: number,
    spotA: { x: number; y: number },
    spotB: { x: number; y: number },
  ): void {
    a.social.kind = kind;
    b.social.kind = kind;
    a.social.partner = b.id;
    b.social.partner = a.id;
    a.social.timer = ticks;
    b.social.timer = ticks;
    a.social.side = 0;
    b.social.side = 1;
    a.wanderTo(this.pathTo(a, spotA));
    b.wanderTo(this.pathTo(b, spotB));
  }

  /**
   * Digits for the seven-segment face, in 12-hour form. A single-digit hour is
   * padded with a SPACE rather than a zero: a leading zero on a 12-hour clock is
   * wrong, and a blank slot keeps the digits from shifting between 9:59 and 10:00.
   */
  private clockDigits(): string {
    const now = new Date();
    const hours24 = now.getHours();
    const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${String(hours).padStart(2, " ")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  /** Caption under the digits: meridiem and date. */
  private clockCaption(): string {
    const now = new Date();
    const meridiem = now.getHours() < 12 ? "AM" : "PM";
    return `${meridiem} ${DAY_NAMES[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;
  }

  /**
   * What is pinned to the notice board. Derived from the clock rather than a
   * timer, so it is right after a restart and cannot drift: the reminder is up
   * for the first couple of minutes of every hour.
   */
  private noticeText(): string {
    // The pin is a review aid and works even when the reminder is switched off,
    // so the setting can be previewed before it is turned on.
    if (this.pinNotice) return "DRINK WATER";
    if (!this.reminderOn) return "";
    const now = new Date();
    return now.getMinutes() < REMINDER_MINUTES ? "DRINK WATER" : "";
  }

  private notify(text: string): void {
    this.message = text;
    this.messageTicks = MESSAGE_TICKS;
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  render(): void {
    this.screen.clear(PALETTE.panelAlt);
    this.tabHits = renderTabs(this.screen, this.tab, this.connected, this.options.demo);

    const bodyTopRow = 1;
    const bodyBottomRow = this.screen.rows - 2;

    this.officeHits = [];
    this.rosterHits = [];

    if (bodyBottomRow >= bodyTopRow) {
      if (this.tab === "office") {
        this.officeHits = renderOffice(this.screen, {
          top: bodyTopRow * 2,
          bottom: (bodyBottomRow + 1) * 2,
          camera: this.camera,
          room: this.room,
          areas: this.areas,
          characters: [...this.characters.values()],
          selectedId: this.selectedId,
          hoverId: this.hoverId,
          pet: this.pet,
          tick: this.frameCount,
          clock: this.clockDigits(),
          clockCaption: this.clockCaption(),
          clockColon: Math.floor(this.frameCount / 6) % 2 === 0,
          notice: this.noticeText(),
          company: this.companyName,
          // Roughly one flash a second at 12fps.
          noticeFlash: Math.floor(this.frameCount / NOTICE_FLASH_TICKS) % 2 === 0,
          showNames: this.showNames,
        });
      } else if (this.tab === "settings") {
        renderSettings(this.screen, {
          topRow: bodyTopRow,
          bottomRow: bodyBottomRow,
          companyName: this.companyName,
          editing: this.editing,
          showNames: this.showNames,
          chatter: this.chatter,
          sound: this.sound,
          showClock: this.showClock,
          reminderOn: this.reminderOn,
        });
      } else {
        this.rosterHits = renderRoster(this.screen, {
          topRow: bodyTopRow,
          bottomRow: bodyBottomRow,
          characters: [...this.characters.values()],
          selectedId: this.selectedId,
          scroll: this.rosterScroll,
        });
      }
    }

    if (this.characters.size === 0 && this.tab !== "settings") {
      this.renderEmptyState(bodyTopRow, bodyBottomRow);
    }

    renderStatusBar(
      this.screen,
      this.counts(),
      this.tab === "office" ? OFFICE_HINTS : this.tab === "settings" ? SETTINGS_HINTS : ROSTER_HINTS,
      this.message,
    );
  }

  private renderEmptyState(topRow: number, bottomRow: number): void {
    const row = Math.floor((topRow + bottomRow) / 2);
    const text = this.connected
      ? "No agents yet — start one in a herdr pane"
      : "Waiting for herdr…";
    this.screen.putTextCentered(0, row, this.screen.cols, text, PALETTE.textDim, PALETTE.panelAlt);
  }

  private counts() {
    const counts = { total: 0, working: 0, blocked: 0, done: 0, idle: 0 };
    for (const character of this.characters.values()) {
      counts.total++;
      const status = character.snapshot.status;
      if (status === "working") counts.working++;
      else if (status === "blocked") counts.blocked++;
      else if (status === "done") counts.done++;
      else counts.idle++;
    }
    return counts;
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  /** Returns false when the app should exit. */
  handleKey(key: string): boolean {
    // While the field is open every key belongs to it - otherwise typing a
    // company name containing "q" would quit the office.
    if (this.editing !== null) {
      this.handleEditKey(key);
      return true;
    }
    switch (key) {
      case "q":
      case "\x03":
        return false;
      case "\t":
        this.tab = TAB_ORDER[(TAB_ORDER.indexOf(this.tab) + 1) % TAB_ORDER.length];
        this.screen.invalidate();
        return true;
      case "n":
        this.showNames = !this.showNames;
        this.persist();
        return true;
      case "r":
        this.reminderOn = !this.reminderOn;
        this.notify(this.reminderOn ? "Water reminder on" : "Water reminder off");
        this.persist();
        return true;
      case "w":
        this.pinNotice = !this.pinNotice;
        this.notify(
          this.pinNotice
            ? "Reminder pinned for review"
            : this.reminderOn
              ? "Reminder back on the hour"
              : "Reminder unpinned (it is switched off — r to enable)",
        );
        return true;
      case "c":
        this.showClock = !this.showClock;
        this.relayout(true);
        this.screen.invalidate();
        this.notify(this.showClock ? "Clock on" : "Clock off");
        this.persist();
        return true;
      case "t":
        this.chatter = !this.chatter;
        if (!this.chatter) {
          for (const character of this.characters.values()) character.says("", 0);
        }
        this.notify(this.chatter ? "Chatter on" : "Chatter off");
        this.persist();
        return true;
      case "s":
        this.sound = !this.sound;
        this.notify(this.sound ? "Sound on" : "Sound off");
        this.persist();
        return true;
      case "pageup":
        this.scrollBy(-this.viewportPx() / 2);
        return true;
      case "pagedown":
        this.scrollBy(this.viewportPx() / 2);
        return true;
      case "home":
        this.camera = 0;
        return true;
      case "end":
        this.camera = Math.max(0, this.room.contentHeight - this.viewportPx());
        return true;
      case "\r":
      case "\n":
      case "f":
        if (this.tab === "settings") this.editing = this.companyName;
        else void this.focusSelected();
        return true;
      case "up":
        this.moveSelection(0, -1);
        return true;
      case "down":
        this.moveSelection(0, 1);
        return true;
      case "left":
        this.moveSelection(-1, 0);
        return true;
      case "right":
        this.moveSelection(1, 0);
        return true;
      default:
        return true;
    }
  }

  /** Keystrokes while the company-name field is open. */
  private handleEditKey(key: string): void {
    if (key === "\r" || key === "\n") {
      this.companyName = (this.editing ?? "").trim();
      this.editing = null;
      this.relayout(true);
      this.screen.invalidate();
      this.persist();
      this.notify(this.companyName ? `Company set to ${this.companyName}` : "Company name cleared");
      return;
    }
    if (key === "\x1b") {
      this.editing = null;
      this.notify("Cancelled");
      return;
    }
    if (key === "\x7f" || key === "\b") {
      this.editing = (this.editing ?? "").slice(0, -1);
      return;
    }
    // Printable ASCII only; control bytes and arrow-key names are not text.
    if (key.length === 1 && key >= " " && key <= "~" && (this.editing ?? "").length < 28) {
      this.editing = (this.editing ?? "") + key;
    }
  }

  private orderedIds(): string[] {
    if (this.tab === "roster") {
      return sortCharacters([...this.characters.values()]).map((c) => c.id);
    }
    return [...this.characters.entries()]
      .sort((a, b) => this.officeOrder(a[0]) - this.officeOrder(b[0]))
      .map(([id]) => id);
  }

  /** Reading order in the office: desks first (by desk), then the common area. */
  private officeOrder(id: string): number {
    const desk = this.deskAssignment.get(id);
    if (desk !== undefined) return desk;
    return 1000 + (this.loungeAssignment.get(id) ?? 0);
  }

  private moveSelection(dx: number, dy: number): void {
    const ids = this.orderedIds();
    if (ids.length === 0) return;

    const current = this.selectedId ? ids.indexOf(this.selectedId) : -1;
    if (current === -1) {
      this.selectedId = ids[0];
      this.afterSelectionMove();
      return;
    }

    // In the office, up/down step a whole grid row; the roster is a plain list.
    const step = this.tab === "office" ? dx + dy * this.room.deskColumns : dx + dy;
    const next = Math.max(0, Math.min(ids.length - 1, current + step));
    this.selectedId = ids[next];
    this.afterSelectionMove();
  }

  private afterSelectionMove(): void {
    if (this.tab === "roster") this.scrollRosterToSelection();
    else this.followSelection();
  }

  private scrollRosterToSelection(): void {
    const ids = this.orderedIds();
    const index = this.selectedId ? ids.indexOf(this.selectedId) : -1;
    if (index === -1) return;
    const visible = Math.max(1, this.screen.rows - 3);
    if (index < this.rosterScroll) this.rosterScroll = index;
    else if (index >= this.rosterScroll + visible) this.rosterScroll = index - visible + 1;
  }

  /** Keeps the selected desk inside the office viewport. */
  private followSelection(): void {
    if (this.tab !== "office" || !this.selectedId) return;
    const character = this.characters.get(this.selectedId);
    if (!character) return;

    const viewportPx = this.viewportPx();
    const spotTop = character.spot.y - 8;
    const spotBottom = character.spot.y + DESK_SLOT_H;

    if (spotTop < this.camera) this.camera = spotTop;
    else if (spotBottom > this.camera + viewportPx) this.camera = spotBottom - viewportPx;
    this.clampCamera();
  }

  private clampCamera(): void {
    const viewportPx = this.viewportPx();
    const max = Math.max(0, this.room.contentHeight - viewportPx);
    this.camera = Math.max(0, Math.min(max, this.camera));
  }

  scrollBy(deltaPx: number): void {
    if (this.tab === "office") {
      this.camera += deltaPx;
      this.clampCamera();
    } else {
      const visible = Math.max(1, this.screen.rows - 3);
      const max = Math.max(0, this.characters.size - visible);
      this.rosterScroll = Math.max(0, Math.min(max, this.rosterScroll + Math.sign(deltaPx)));
    }
  }

  /** A click at a terminal cell. Selecting an already-selected agent focuses it. */
  handleClick(col: number, row: number): void {
    for (const hit of this.tabHits) {
      if (row === 0 && col >= hit.col0 && col < hit.col1) {
        this.tab = hit.id;
        this.screen.invalidate();
        return;
      }
    }

    if (this.tab === "roster") {
      for (const hit of this.rosterHits) {
        if (hit.row !== row) continue;
        if (this.selectedId === hit.id) void this.focusSelected();
        else this.selectedId = hit.id;
        return;
      }
      return;
    }

    if (this.petAt(col, row)) {
      this.pet?.pet();
      return;
    }

    const id = this.hitAt(col, row);
    if (!id) return;
    if (this.selectedId === id) void this.focusSelected();
    else this.selectedId = id;
  }

  /** Hover highlights and feeds the tooltip. */
  handleHover(col: number, row: number): void {
    this.hoverId = this.tab === "office" ? this.hitAt(col, row) : null;
  }

  /** Picking a character up and carrying it to another desk. */
  handleDrag(col: number, row: number): void {
    if (this.tab !== "office") return;
    if (!this.draggingId) {
      const id = this.hitAt(col, row);
      if (!id) return;
      this.draggingId = id;
      this.selectedId = id;
      this.dragMoved = false;
      return;
    }
    const character = this.characters.get(this.draggingId);
    if (!character) return;
    // Carry the body so the cursor sits roughly on its chest.
    character.x = col * SUB_X - Math.floor(CHAR_W / 2);
    character.y = row * SUB_Y + this.camera - SUB_Y - 4;
    character.phase = "settled";
    this.dragMoved = true;
  }

  /** Dropping a character: the desk under the cursor becomes its desk. */
  handleRelease(col: number, row: number): void {
    const id = this.draggingId;
    this.draggingId = null;
    if (!id || !this.dragMoved) return;
    this.dragMoved = false;

    const character = this.characters.get(id);
    if (!character) return;

    const slot = this.deskSlotAt(col, row);
    if (slot === null) {
      // Dropped on open floor: walk back to where it belongs.
      character.moveTo(character.spot, this.pathTo(character, character.spot));
      return;
    }

    // Swap with whoever already has that desk so nobody is left seatless.
    const previous = [...this.deskAssignment.entries()].find(([, index]) => index === slot);
    const mine = this.deskAssignment.get(id);
    if (previous && previous[0] !== id) {
      if (mine === undefined) this.deskAssignment.delete(previous[0]);
      else this.deskAssignment.set(previous[0], mine);
    }
    this.deskAssignment.set(id, slot);
    this.loungeAssignment.delete(id);
    this.relayout(false);
    this.notify(`Moved ${character.displayName} to desk ${slot + 1}`);
  }

  /** Desk index whose slot contains this cell, or null. */
  private deskSlotAt(col: number, row: number): number | null {
    const px = col * SUB_X;
    const py = row * SUB_Y + this.camera - SUB_Y;
    for (const slot of this.room.desks) {
      if (px < slot.x || px >= slot.x + DESK_SLOT_W) continue;
      if (py < slot.y || py >= slot.y + DESK_SLOT_H) continue;
      return slot.index;
    }
    return null;
  }

  private petAt(col: number, row: number): boolean {
    if (!this.pet) return false;
    const px = col * SUB_X;
    const py = row * SUB_Y + this.camera - SUB_Y;
    return (
      px >= this.pet.x - SUB_X &&
      px <= this.pet.x + 10 &&
      py >= this.pet.y - 2 &&
      py <= this.pet.y + 6
    );
  }

  private hitAt(col: number, row: number): string | null {
    // A cell spans SUB_X subpixels across and SUB_Y down; a click anywhere in
    // it should hit whatever is drawn inside it.
    const left = col * SUB_X;
    const right = left + SUB_X - 1;
    const top = row * SUB_Y;
    const bottom = top + SUB_Y - 1;
    for (const hit of this.officeHits) {
      if (right < hit.x0 || left >= hit.x1) continue;
      if (bottom < hit.y0 || top > hit.y1) continue;
      return hit.id;
    }
    return null;
  }

  private async focusSelected(): Promise<void> {
    if (!this.selectedId) {
      this.notify("Select an agent first");
      return;
    }
    const character = this.characters.get(this.selectedId);
    if (!character) return;

    if (this.options.demo || !this.options.socketPath) {
      this.notify(`Demo mode — would focus ${character.displayName}`);
      return;
    }

    try {
      await focusAgent(this.options.socketPath, character.snapshot.paneId);
      this.notify(`Focused ${character.displayName}`);
    } catch (err) {
      this.notify(`Focus failed: ${(err as Error).message}`);
    }
  }
}
