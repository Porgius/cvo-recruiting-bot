// Who gets the next lead.
//
//   New leads (and the 10 AM hand-out): whoever with the Recruiter role has waited longest since their
//   last NEW lead. Hand-offs don't move anyone's turn, so fresh leads alternate evenly.
//   Hand-offs: whoever has waited longest since ANY assignment, never the person who just had it.
//
// Turns and daily counts live in the bot-state blob store with strong consistency, so leads that arrive
// seconds apart see each other's assignments. /rotation shows who's next and the counts.
import { getStore } from "@netlify/blobs";
import { TIMEZONE } from "./config.mjs";
import { listRecruiters } from "./discord.mjs";

// { turn: n, lastNew: {id: turn}, lastAny: {id: turn}, days: {"2026-10-14": {id: {new, handoff}}} }
// A turn number that only counts up, not a clock time, so turns taken in the same instant still line up.
const KEY = "rotation";
const KEEP_DAYS = 14;

/** The bot's small key-value store. Strong consistency: a write is visible to the very next read. */
export const botState = () => getStore({ name: "bot-state", consistency: "strong" });

const easternDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
const empty = () => ({ turn: 0, lastNew: {}, lastAny: {}, days: {} });

async function load() {
  try {
    return { ...empty(), ...JSON.parse((await botState().get(KEY)) || "{}") };
  } catch {
    return empty();
  }
}

async function save(state) {
  const days = Object.keys(state.days).sort().slice(-KEEP_DAYS);
  state.days = Object.fromEntries(days.map((d) => [d, state.days[d]]));
  await botState().set(KEY, JSON.stringify(state));
}

const waitedLongest = (recruiters, last) => {
  const t = (id) => last[id] || 0; // never assigned = first in line
  return [...recruiters].sort((a, b) => t(a.id) - t(b.id) || a.id.localeCompare(b.id))[0];
};

/**
 * Take `count` turns of `kind` ("new" or "handoff"), skipping `excludeId`. Records them and returns the
 * recruiters in order ([] when nobody has the Recruiter role).
 */
export async function takeTurns(kind, count = 1, excludeId) {
  const recruiters = (await listRecruiters()).filter((r) => r.id !== excludeId);
  if (!recruiters.length || count < 1) return [];
  const state = await load();
  const day = easternDay();
  state.days[day] ||= {};
  const picks = [];
  for (let i = 0; i < count; i++) {
    const r = waitedLongest(recruiters, kind === "new" ? state.lastNew : state.lastAny);
    state.turn = Number(state.turn || 0) + 1;
    if (kind === "new") state.lastNew[r.id] = state.turn;
    state.lastAny[r.id] = state.turn;
    const tally = (state.days[day][r.id] ||= { new: 0, handoff: 0 });
    tally[kind === "new" ? "new" : "handoff"] += 1;
    picks.push(r);
  }
  await save(state);
  return picks;
}

/** For /rotation: next up, then each recruiter's new leads and hand-offs today and over the last 7 days. */
export async function rotationReport() {
  const recruiters = await listRecruiters();
  if (!recruiters.length) return "Nobody has the Recruiter role yet.";
  const state = await load();
  const today = easternDay();
  const week = Object.keys(state.days).sort().slice(-7);
  const sum = (id, days) => days.reduce((s, d) => ({
    new: s.new + (state.days[d]?.[id]?.new || 0),
    handoff: s.handoff + (state.days[d]?.[id]?.handoff || 0),
  }), { new: 0, handoff: 0 });
  const next = waitedLongest(recruiters, state.lastNew);
  const lines = recruiters
    .map((r) => ({ r, t: sum(r.id, [today]), w: sum(r.id, week) }))
    .sort((a, b) => b.w.new - a.w.new || a.r.name.localeCompare(b.r.name))
    .map(({ r, t, w }) => `**${r.name}**: today ${t.new} new, ${t.handoff} handed off · 7 days ${w.new} new, ${w.handoff} handed off`);
  return [`**Next new lead goes to ${next.name}.**`, ...lines, "", "Counts started when this rotation went live."].join("\n");
}
