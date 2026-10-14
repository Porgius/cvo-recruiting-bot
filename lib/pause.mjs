// Overnight pause (/pause, /resume, and automatically at 11 PM ET): stops lead rotation until 10 AM ET.
// While paused, new Hot/Warm leads still post in #recruiting-leads, but nobody is assigned or pinged and
// nothing gets passed. At 10 AM the reassign job (or /resume) deals them out round-robin
// (lib/leads.mjs distributeOvernightLeads).
import { TIMEZONE } from "./config.mjs";
import { easternAt } from "./nurture.mjs";
import { botState } from "./rotation.mjs";

export const RESUME_HOUR = 10; // 10 AM ET
export const AUTO_PAUSE_HOUR = 23; // 11 PM ET: rotation pauses on its own every night
const KEY = "pause";
const NIGHT_KEY = "autoPauseNight"; // the night the auto-pause last ran, so a /resume during the night sticks
const store = botState;

const easternHour = (d) => Number(new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", hourCycle: "h23" }).format(d));
const easternDate = (d) => d.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // 2026-10-13

/** Which night a time falls in, named by that evening's date (11 PM Tue to 9:59 AM Wed = Tue's). Daytime: null. */
export function nightOf(now = new Date()) {
  const hour = easternHour(now);
  if (hour >= AUTO_PAUSE_HOUR) return easternDate(now);
  if (hour < RESUME_HOUR) return easternDate(new Date(now.getTime() - 12 * 3600e3));
  return null;
}

/**
 * Run every 5 minutes (reassign job). Between 11 PM and 10 AM ET, pauses rotation once per night.
 * Returns the resume time when it just paused, else null.
 */
export async function autoPause(now = new Date()) {
  const night = nightOf(now);
  if (!night || (await store().get(NIGHT_KEY)) === night) return null;
  await store().set(NIGHT_KEY, night);
  if (pauseActive(await getPause(), now)) return null; // someone already paused by hand
  return startPause("auto", now);
}

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
