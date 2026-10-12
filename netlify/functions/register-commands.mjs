// Registers the slash commands on the CVO server. Safe to run again after changes.
import { discord, json } from "../../lib/discord.mjs";
import { GUILD_ID, env } from "../../lib/config.mjs";

const COMMANDS = [
  { name: "myleads", description: "Your open recruiting leads and their stages", type: 1 },
  {
    name: "lead", description: "Look up a recruiting lead", type: 1,
    options: [{ type: 3, name: "name", description: "Part of the lead's name", required: true }],
  },
  {
    name: "scoreboard", description: "Recruiting funnel, by recruiter and by ad", type: 1,
    options: [{ type: 4, name: "days", description: "How many days back (default 30)", required: false, min_value: 1, max_value: 365 }],
  },
];

export default async () => {
  try {
    const out = await discord("PUT", `/applications/${env("DISCORD_APP_ID")}/guilds/${GUILD_ID}/commands`, COMMANDS);
    return json({ registered: out.map((c) => c.name) });
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
};

export const config = { path: "/api/register-commands" };
