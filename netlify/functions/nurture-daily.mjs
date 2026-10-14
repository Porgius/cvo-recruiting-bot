// Every day at 11 AM ET: info call invites for leads nobody reached in 3 days, one re-invite for
// no-shows, and monthly check-ins (lib/nurture.mjs runDailyNurture). Posts a summary in #nurture-leads.
import { runDailyNurture } from "../../lib/nurture.mjs";
import { discord } from "../../lib/discord.mjs";
import { NURTURE_CHANNEL_ID } from "../../lib/config.mjs";

const names = (recs) => recs.map((r) => r.fields["Full Name"] || "Unnamed").join(", ");

export default async () => {
  const done = await runDailyNurture();
  const lines = [
    done.noContact.length && `📨 **Nobody reached in 3 days**, invited to Sunday's info call: ${names(done.noContact)}`,
    done.reinvite.length && `🔁 **Missed the call**, invited to the next one: ${names(done.reinvite)}`,
    done.monthly.length && `📅 **Monthly check-in** sent: ${names(done.monthly)}`,
  ].filter(Boolean);
  console.log(JSON.stringify({ noContact: done.noContact.length, reinvite: done.reinvite.length, monthly: done.monthly.length }));
  if (lines.length) {
    await discord("POST", `/channels/${NURTURE_CHANNEL_ID}/messages`, {
      content: `**Info call emails today**\n${lines.join("\n")}\nUse \`/infocall\` after Sunday's call so people who came don't get a re-invite.`.slice(0, 1990),
      allowed_mentions: { parse: [] },
    });
  }
};

// Cron is UTC: 15:00 UTC = 11 AM EDT (10 AM EST in winter).
export const config = { schedule: "0 15 * * *" };
