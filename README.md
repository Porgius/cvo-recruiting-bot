# CVO Recruiting Bot

Discord bot for the CVO recruiting pipeline, hosted on Netlify Functions.

- `/api/interactions` — Discord buttons, dropdowns, pop-up forms, and slash commands
- `/api/new-lead` — Make calls this with `{ "recordId": "rec…" }` after a Meta lead lands in Airtable
- `/api/register-commands` — registers `/myleads`, `/lead`, `/scoreboard` on the CVO server
- `reassign` (scheduled, every 5 min) — hands unclaimed Hot/Warm leads to the next recruiter after 15 minutes, 8am–10pm ET

## Environment variables (set in Netlify, never in code)
- `DISCORD_BOT_TOKEN` — secret
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APP_ID`
- `AIRTABLE_TOKEN` — secret (scopes: data.records:read, data.records:write; CVO Recruiting base)

Server, channel, role, and Airtable IDs live in `lib/config.mjs`.
