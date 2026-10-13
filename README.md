# CVO Recruiting Bot

Discord bot for the CVO recruiting pipeline, hosted on Netlify Functions.

- `/api/interactions` — Discord buttons, dropdowns, pop-up forms, and slash commands
- `/api/new-lead` — Make calls this with `{ "recordId": "rec…" }` after a Meta lead lands in Airtable
- `/api/register-commands` — registers `/myleads`, `/lead`, `/scoreboard` on the CVO server
- `reassign` (scheduled, every 5 min) — hands unclaimed Hot/Warm leads to the next recruiter after 15 minutes, 8am–10pm ET
- `/api/unsubscribe`, `/api/info-call.ics` — links in the nurture emails (proxied from pinkteamfiber.com)

## Nurture emails → Sunday Zoom info call
Nurture leads, plus Cold leads from the website (rookies), get emailed into the weekly Zoom info call
(Sunday 6:00–6:40 PM ET): an invite right away, a blitz overview Friday, a reminder Sunday at 4 PM, and a
follow-up Monday. All of them are scheduled in Resend when the lead comes in. Airtable shows it in
`Nurture`, `Info Call` and `Nurture Email IDs`. Unsubscribing, or marking the lead Dead or Hired, cancels
the rest. Zoom link, times and wording are in `lib/config.mjs` and `lib/nurture.mjs`.

To enroll a lead that came in before this existed, POST its record ID to `/api/new-lead` again.

## Environment variables (set in Netlify, never in code)
- `DISCORD_BOT_TOKEN` — secret
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APP_ID`
- `AIRTABLE_TOKEN` — secret (scopes: data.records:read, data.records:write; CVO Recruiting base)
- `RESEND_API_KEY` — secret, for the nurture emails (needs to send and cancel; full access works)

Server, channel, role, and Airtable IDs live in `lib/config.mjs`.
