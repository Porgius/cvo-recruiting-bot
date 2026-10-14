# CVO Recruiting Bot

Discord bot for the CVO recruiting pipeline, hosted on Netlify Functions.

- `/api/interactions` — Discord buttons, dropdowns, pop-up forms, and slash commands
- `/api/new-lead` — Make calls this with `{ "recordId": "rec…" }` after a Meta lead lands in Airtable
- `/api/register-commands` — registers `/myleads`, `/lead`, `/scoreboard` on the CVO server
- `reassign` (scheduled, every 5 min) — hands unclaimed Hot/Warm leads to the next recruiter after 15 minutes, 8am–10pm ET
- `/api/unsubscribe`, `/api/info-call.ics` — links in the nurture emails (proxied from pinkteamfiber.com)
- `/api/lead-reply` — pinkteamfiber.com's inbound mail function sends every received email's Resend ID here; replies from leads get posted in Discord (YES pings @Recruiter, STOP cancels the emails) and logged in Airtable (`Notes`, `Replied At`)
- `/infocall` — during or after the Sunday call, tick who showed up; sets `Attended Call` and posts each attendee for follow-up
- `/pause` — stops lead rotation until 10 AM ET: new Hot/Warm leads post unassigned with no pings, Pass puts a lead back in the pile, and no 15-minute hand-offs. At 10 AM the `reassign` job deals them out round-robin (Hot first), gives leads already waiting a fresh 15 minutes, and posts one summary tagging each recruiter. `/resume` does that right away. State lives in the `bot-state` blob store (`pause`). It also turns on by itself every night at 11 PM ET (`AUTO_PAUSE_HOUR` in `lib/pause.mjs`), once per night, so a `/resume` during the night stays resumed until the next night.

## Nurture emails → Sunday Zoom info call
Nurture leads, plus Cold leads from the website (rookies), get emailed into the weekly Zoom info call
(Sunday 6:00–6:40 PM ET): an invite right away, a blitz overview Friday, a reminder Sunday at 4 PM, and a
follow-up Monday. All of them are scheduled in Resend when the lead comes in. Airtable shows it in
`Nurture`, `Info Call` and `Nurture Email IDs`. Unsubscribing, or marking the lead Dead or Hired, cancels
the rest. Zoom link, times and wording are in `lib/config.mjs` and `lib/nurture.mjs`.

Website rookies (Cold, Ad Name starting with "Website") are also posted to #nurture-leads so a recruiter can text them.

Also:
- Facebook Hot/Warm leads get a "a recruiter will call or text you today" email the moment they come in.
- `nurture-daily` (scheduled, 11 AM ET) emails three groups and posts a summary in #nurture-leads:
  - leads still New with no contact logged 3–10 days after they came in get the full sequence
  - no-shows (not ticked in `/infocall`) get one re-invite: Friday invite + Sunday reminder
  - after that, a monthly check-in for the next call, up to 5 invites in total (`Info Call Invites`)
- Anyone unsubscribed, marked Dead/Hired, or moved past New by a recruiter is skipped.

To enroll a lead that came in before this existed, POST `{ "recordId": "rec…", "nurtureOnly": true }` to
`/api/new-lead`. That sends the emails without posting the lead to Discord.

## Environment variables (set in Netlify, never in code)
- `DISCORD_BOT_TOKEN` — secret
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APP_ID`
- `AIRTABLE_TOKEN` — secret (scopes: data.records:read, data.records:write; CVO Recruiting base)
- `NURTURE_RESEND_API_KEY` — secret, full-access Resend key for the nurture emails (they're sent and cancelled)

Server, channel, role, and Airtable IDs live in `lib/config.mjs`.
