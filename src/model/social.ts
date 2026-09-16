/**
 * What idle agents get up to in the break room.
 *
 * Everything here is cosmetic: a character's social activity never changes what
 * its agent is doing, and any status change cancels it immediately. It exists
 * so the common area looks like a room people are waiting in rather than a
 * shelf of idle sprites.
 */

export type SocialKind =
  | "none"
  | "chat"
  | "coffee"
  | "cocktail"
  | "pingPong"
  | "pool"
  | "foosball";

export interface Social {
  kind: SocialKind;
  /** The other character in a two-person activity. */
  partner: string | null;
  /** Ticks left before the activity ends. */
  timer: number;
  /** Which end of a game table, or which side of a conversation. */
  side: 0 | 1;
  /** Line currently being spoken, and how long it stays up. */
  say: string | null;
  sayTimer: number;
  /** Set once a character has collected a coffee; it keeps the cup afterwards. */
  cup: boolean;
}

export function idleSocial(): Social {
  return { kind: "none", partner: null, timer: 0, side: 0, say: null, sayTimer: 0, cup: false };
}

/** Ticks (~12/s) an activity runs for before people drift off again. */
export const CHAT_TICKS = 220;
export const GAME_TICKS = 420;
export const COFFEE_TICKS = 90;

/** Small talk. Short enough to fit a bubble at this scale. */
const CHAT_LINES: string[] = [
  "tests are green",
  "that build took ages",
  "I rebased again",
  "who owns this file?",
  "my context is at 90%",
  "nice catch earlier",
  "rate limit again…",
  "did you see that trace?",
  "one more refactor",
  "it works locally",
  "needs a second pair of eyes",
  "merged it",
  "flaky test, third time",
  "good morning",
  "coffee?",
  "almost done",
  "back in a sec",
  "that was a long turn",
  "CI is slow today",
  "what changed here?",
];

/** Replies that make an exchange read like a conversation. */
const CHAT_REPLIES: string[] = [
  "same here",
  "ha, yes",
  "no idea",
  "tell me about it",
  "nice one",
  "hmm",
  "on it",
  "sounds right",
  "good luck",
  "finally",
  "I'll take a look",
  "agreed",
];

export function randomLine(): string {
  return CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
}

export function randomReply(): string {
  return CHAT_REPLIES[Math.floor(Math.random() * CHAT_REPLIES.length)];
}

/** Coffee-machine chatter, said while waiting for the cup to fill. */
export function coffeeLine(): string {
  return Math.random() < 0.5 ? "need this" : "refill";
}

/** Said while waiting at the cocktail counter. */
export function cocktailLine(): string {
  const lines = ["one for the road", "make it two", "cheers", "long day"];
  return lines[Math.floor(Math.random() * lines.length)];
}
