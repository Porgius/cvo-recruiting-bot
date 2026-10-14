// Every 5 minutes: hand unclaimed Hot/Warm leads to the next recruiter after 15 minutes.
// Only during 8am–10pm Eastern so nobody gets pinged overnight.
// Rotation pauses on its own at 11 PM ET (or with /pause); at 10 AM ET this job ends the pause and hands
// out the overnight leads. A /resume during the night stays resumed until the next night.
import { staleUnclaimedLeads, handOff, distributeOvernightLeads } from "../../lib/leads.mjs";
import { getPause, pauseActive, clearPause, autoPause, resumeLabel } from "../../lib/pause.mjs";
import { discord } from "../../lib/discord.mjs";
import { REASSIGN_HOURS, TIMEZONE, LEADS_CHANNEL_ID } from "../../lib/config.mjs";

export default async () => {
  const pause = await getPause();
  if (pause && !pauseActive(pause)) {
    await clearPause(); // first, so an overlapping run can't hand the same leads out twice
    const r = await distributeOvernightLeads("☀️ **Morning hand-out.** Lead rotation is back on.");
    console.log("morning hand-out", JSON.stringify(r));
  }

  const autoUntil = await autoPause();
  if (autoUntil) {
    await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
      content: `🌙 **Night mode.** Lead rotation is paused until **${resumeLabel(autoUntil)}**. New Hot/Warm leads still post here, unassigned and with no pings, and get handed out then. \`/resume\` hands them out sooner.`,
      allowed_mentions: { parse: [] },
    });
  }
  if (pauseActive(pause) || autoUntil) return;

  const hour = Number(new Date().toLocaleString("en-US", { timeZone: TIMEZONE, hour: "numeric", hour12: false }));
  if (hour < REASSIGN_HOURS.start || hour >= REASSIGN_HOURS.end) return;
  const leads = await staleUnclaimedLeads();
  for (const rec of leads) {
    try {
      await handOff(rec, `⏰ <@${rec.fields["Recruiter Discord ID"]}> didn't claim in 15 min`);
    } catch (err) {
      console.error("handoff failed", rec.id, err);
    }
  }
};

// Cron runs in UTC; every 5 minutes, all day (the hour check above limits it to ET business hours).
export const config = { schedule: "*/5 * * * *" };
