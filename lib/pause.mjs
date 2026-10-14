// Overnight pause (/pause, /resume): stops lead rotation until 10 AM ET.
// While paused, new Hot/Warm leads still post in #recruiting-leads, but nobody is assigned or pinged and
// nothing gets passed. At 10 AM the reassign job (or /resume) deals them out round-robin
// (lib/leads.mjs distributeOvernightLeads).
import { getStore } from "@netlify/blobs";
import { TIMEZONE } from "./config.mjs";
import { easternAt } from "./nurture.mjs";

export const RESUME_HOUR = 10; // 10 AM ET
const KEY = "pause";
const store = () => getStore("bot-state");

/** { until, by, at } or null. Still returned after `until` passes, until the morning hand-out clears it. */
export async function getPause() {
  try {
    const raw = await store().get(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const pauseActive = (pause, now = new Date()) => Boolean(pause && now < new Date(pause.until));

/** The next 10 AM ET: today's if it's still ahead, else tomorrow's. */
export function nextResume(now = new Date()) {
  const today = easternAt(now, 0, RESUME_HOUR);
  return today > now ? today : easternAt(now, 1, RESUME_HOUR);
}

export async function startPause(by, now = new Date()) {
  const until = nextResume(now);
  await store().set(KEY, JSON.stringify({ until: until.toISOString(), by, at: now.toISOString() }));
  return until;
}

export const clearPause = () => store().delete(KEY);

/** "Wed 10:00 AM ET" */
export const resumeLabel = (until) =>
  `${new Date(until).toLocaleString("en-US", { timeZone: TIMEZONE, weekday: "short", hour: "numeric", minute: "2-digit" })} ET`;
