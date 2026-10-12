// Every 5 minutes: hand unclaimed Hot/Warm leads to the next recruiter after 15 minutes.
// Only during 8am–10pm Eastern so nobody gets pinged overnight.
import { staleUnclaimedLeads, handOff } from "../../lib/leads.mjs";
import { REASSIGN_HOURS, TIMEZONE } from "../../lib/config.mjs";

export default async () => {
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
