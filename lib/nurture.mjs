// Nurture emails: invite rookies and Nurture-tier leads to the weekly Sunday Zoom info call.
//
// Who: every Nurture lead, plus Cold leads from the website (people new to door-to-door).
// When a lead comes in, the whole sequence is queued at once with Resend's scheduled sending,
// so there's no cron. The email IDs are saved on the lead so the rest can be cancelled.
//
//   invite    ~10 min after they come in   Zoom link, calendar links, what the call covers
//   blitz     Friday 10 AM ET              what a blitz week looks like (skipped if too close to the invite)
//   reminder  Sunday 4 PM ET               "today at 6" (skipped if too close to the invite)
//   followup  Monday 10 AM ET              reply YES to get started, or catch next Sunday's call
//
// The rest are cancelled when they unsubscribe (/api/unsubscribe) or the lead is marked Dead or Hired.
// Env: NURTURE_RESEND_API_KEY, a full-access Resend key (it has to send and cancel). Falls back to RESEND_API_KEY.
import { INFO_CALL, NURTURE_EMAIL, TIMEZONE, env } from "./config.mjs";
import { getLead, updateLead } from "./airtable.mjs";
import { sleep } from "./discord.mjs";

const HOUR = 3600e3;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EVENT_TITLE = "Pink Team Fiber info call (Zoom)";

// ---------- Eastern time ----------
function offsetMinutes(date) {
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, timeZoneName: "shortOffset" })
    .formatToParts(date).find((p) => p.type === "timeZoneName").value; // e.g. "GMT-4"
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

function easternDay(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), weekday: p.weekday };
}

/** `days` after the Eastern calendar day of `date`, at hour:minute Eastern. */
export function easternAt(date, days, hour, minute = 0) {
  const { y, m, d } = easternDay(date);
  const wall = Date.UTC(y, m - 1, d + days, hour, minute);
  let t = wall - offsetMinutes(new Date(wall)) * 60e3;
  t = wall - offsetMinutes(new Date(t)) * 60e3; // settle the offset if a DST switch is in between
  return new Date(t);
}

/** The info call someone who comes in at `now` is invited to. */
export function nextInfoCall(now = new Date()) {
  const { hour, minute } = INFO_CALL.start;
  const ahead = (WEEKDAYS.indexOf(INFO_CALL.weekday) - WEEKDAYS.indexOf(easternDay(now).weekday) + 7) % 7;
  let call = easternAt(now, ahead, hour, minute);
  if (call - now < INFO_CALL.minLeadHours * HOUR) call = easternAt(call, 7, hour, minute);
  return call;
}

/** When each email in the sequence goes out. */
export function nurturePlan(now = new Date()) {
  const call = nextInfoCall(now);
  const invite = new Date(now.getTime() + NURTURE_EMAIL.inviteDelayMinutes * 60e3);
  const steps = [{ key: "invite", at: invite }];
  const blitz = easternAt(call, -2, 10);
  if (blitz - invite >= 12 * HOUR) steps.push({ key: "blitz", at: blitz });
  const reminder = easternAt(call, 0, 16);
  if (reminder - invite >= 2 * HOUR) steps.push({ key: "reminder", at: reminder });
  steps.push({ key: "followup", at: easternAt(call, 1, 10) });
  return { call, nextCall: easternAt(call, 7, INFO_CALL.start.hour, INFO_CALL.start.minute), steps };
}

// ---------- formatting ----------
const fmt = (date, opts, timeZone = TIMEZONE) => new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(date);
const dayLabel = (d) => fmt(d, { weekday: "long", month: "long", day: "numeric" }); // Sunday, October 18
const shortDay = (d) => fmt(d, { weekday: "long", month: "short", day: "numeric" }); // Sunday, Oct 18
const clock = (d, tz) => fmt(d, { hour: "numeric", minute: "2-digit" }, tz).replace(":00", ""); // 6 PM
const weekdayName = (d) => fmt(d, { weekday: "long" });

/** "6 PM ET (5 PM CT, 4 PM MT, 3 PM PT)" */
function timeLine(call) {
  const zones = [["America/Chicago", "CT"], ["America/Denver", "MT"], ["America/Los_Angeles", "PT"]];
  return `${clock(call)} ET (${zones.map(([tz, abbr]) => `${clock(call, tz)} ${abbr}`).join(", ")})`;
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20261018T220000Z
const callEnd = (call) => new Date(call.getTime() + INFO_CALL.durationMinutes * 60e3);

function calendarLinks(call) {
  const google = "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE",
    text: EVENT_TITLE,
    dates: `${stamp(call)}/${stamp(callEnd(call))}`,
    details: `Join on Zoom: ${INFO_CALL.zoomUrl}\nQuestions? Text ${NURTURE_EMAIL.phone}.`,
    location: INFO_CALL.zoomUrl,
  });
  const ics = `${NURTURE_EMAIL.siteUrl}/info-call.ics?` + new URLSearchParams({ t: call.toISOString() });
  return { google, ics };
}

/** Calendar file for one call, for Apple Calendar and Outlook (served by /api/info-call.ics). */
export function infoCallIcs(call) {
  const text = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const fold = (line) => line.match(/.{1,74}/g).join("\r\n "); // RFC 5545: 75-octet lines (ASCII only here)
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pink Team Fiber//Info Call//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:info-call-${stamp(call)}@pinkteamfiber.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(call)}`,
    `DTEND:${stamp(callEnd(call))}`,
    `SUMMARY:${text(EVENT_TITLE)}`,
    `LOCATION:${text(INFO_CALL.zoomUrl)}`,
    `URL:${INFO_CALL.zoomUrl}`,
    `DESCRIPTION:${text(`Join on Zoom: ${INFO_CALL.zoomUrl}\nQuestions? Text ${NURTURE_EMAIL.phone}.`)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(EVENT_TITLE)}`, "TRIGGER:-PT30M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

// ---------- email content ----------
// A block is a paragraph string, { text, html } for a paragraph with links, or { button } / { list }.
function nurtureEmails({ name, call, nextCall }) {
  const hey = name ? `Hey ${name},` : "Hey,";
  const zoom = { button: "Join on Zoom", url: INFO_CALL.zoomUrl };
  const cal = calendarLinks(call);
  const phone = NURTURE_EMAIL.phone;
  const sms = `sms:+1${phone.replace(/\D/g, "").slice(-10)}`;
  const questions = {
    text: `Questions? Text ${phone} or reply to this email.`,
    html: `Questions? Text <a href="${sms}" style="${LINK}">${phone}</a> or reply to this email.`,
  };
  const day = weekdayName(call);

  return {
    invite: {
      subject: `You're invited: Pink Team info call on ${shortDay(call)} at ${clock(call)} ET`,
      blocks: [
        hey,
        "Thanks for reaching out about selling fiber with Pink Team.",
        `Every ${day} we run a ${INFO_CALL.durationMinutes}-minute Zoom call for people who are new to door-to-door or still deciding. You'll see how the job works and get your questions answered before you commit to anything.`,
        { text: `Your call: ${dayLabel(call)} at ${timeLine(call)}`, html: `<strong>Your call:</strong> ${esc(dayLabel(call))} at ${esc(timeLine(call))}` },
        zoom,
        {
          text: `Add it to your calendar:\nGoogle: ${cal.google}\nApple or Outlook: ${cal.ics}`,
          html: `Add it to your calendar: <a href="${esc(cal.google)}" style="${LINK}">Google</a> &middot; <a href="${esc(cal.ics)}" style="${LINK}">Apple or Outlook</a>`,
        },
        "What we'll cover:",
        { list: [
          `How the pay works: ${NURTURE_EMAIL.payText} per deal, as a 1099 contractor`,
          "What a blitz week looks like, start to finish",
          "How travel and housing work",
          "Training if you've never knocked doors",
          "Your questions",
        ] },
        `Can't make this one? It's the same time every ${day}, same link.`,
        questions,
      ],
    },

    blitz: {
      subject: "What a blitz week looks like",
      blocks: [
        hey,
        `Before ${day}'s call, here's a quick look at the job.`,
        "Most of our work is travel blitzes. The team goes to a market where fiber is going in and works it together. A blitz day looks like this:",
        { list: [
          "9:00 AM team meeting",
          "9:30 AM training",
          "10:30 AM first door",
          "2:00 PM lunch",
          "2:30 to 8:00 PM back on doors",
          "9:00 PM evening breakdown",
        ] },
        { text: `Pay: ${NURTURE_EMAIL.payText} per deal, no cap. You're a 1099 contractor.`, html: `<strong>Pay:</strong> ${NURTURE_EMAIL.payText} per deal, no cap. You're a 1099 contractor.` },
        { text: "Housing: we front it on blitzes, so you don't need money saved up to go. It comes out of your commissions.", html: "<strong>Housing:</strong> we front it on blitzes, so you don't need money saved up to go. It comes out of your commissions." },
        {
          text: `More on the blitz page: ${NURTURE_EMAIL.siteUrl}/blitz-sales-jobs/`,
          html: `More on the <a href="${NURTURE_EMAIL.siteUrl}/blitz-sales-jobs/" style="${LINK}">blitz page</a>.`,
        },
        `See you ${day} at ${timeLine(call)}.`,
        zoom,
      ],
    },

    reminder: {
      subject: `Today at ${clock(call)} ET: Pink Team info call`,
      blocks: [
        hey,
        `Quick reminder: the info call is today at ${timeLine(call)}. It takes ${INFO_CALL.durationMinutes} minutes.`,
        zoom,
        "Bring your questions. There's nothing to prepare.",
        questions,
      ],
    },

    followup: {
      subject: "Next step with Pink Team",
      blocks: [
        hey,
        "Thanks if you made it to yesterday's call.",
        "Want to get started? Reply YES to this email and a recruiter will reach out to talk next steps.",
        `Missed it? The next one is ${dayLabel(nextCall)} at ${timeLine(nextCall)}. Same link:`,
        zoom,
        questions,
      ],
    },
  };
}

const LINK = "color:#d6006e;";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function render({ subject, blocks }, unsubscribeUrl) {
  const text = [];
  const html = [];
  for (const b of blocks) {
    if (typeof b === "string") {
      text.push(b);
      html.push(`<p style="margin:0 0 16px;">${esc(b)}</p>`);
    } else if (b.button) {
      text.push(`${b.button}: ${b.url}`);
      html.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="background:#d6006e;border-radius:8px;">` +
          `<a href="${esc(b.url)}" style="display:inline-block;padding:14px 28px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(b.button)}</a></td></tr></table>`,
      );
    } else if (b.list) {
      text.push(b.list.map((item) => `- ${item}`).join("\n"));
      html.push(`<ul style="margin:0 0 16px;padding-left:22px;">${b.list.map((item) => `<li style="margin:0 0 6px;">${esc(item)}</li>`).join("")}</ul>`);
    } else {
      text.push(b.text);
      html.push(`<p style="margin:0 0 16px;">${b.html}</p>`);
    }
  }
  text.push("Pink Team Fiber");
  html.push(`<p style="margin:8px 0 0;color:#59394a;">Pink Team Fiber</p>`);

  const footer = "Pink Team Fiber is a CVO company. You're getting this because you asked about sales jobs with us.";
  text.push(`--
${footer}
Unsubscribe: ${unsubscribeUrl}`);

  // Same look as the website's application emails (pinkteamfiber-site/netlify/functions/submission-created.mts).
  const page = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f1f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;border-top:4px solid #ff2d8e;">
        <tr><td style="padding:32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1c0512;">
${html.join("\n")}
        </td></tr>
      </table>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a6e7c;margin:16px 0 0;">${footer} <a href="${esc(unsubscribeUrl)}" style="color:#8a6e7c;">Unsubscribe</a></p>
    </td></tr>
  </table>
</body></html>`;
  return { subject, text: text.join("\n\n"), html: page };
}

// ---------- Resend ----------
function resendKey() {
  for (const name of ["NURTURE_RESEND_API_KEY", "RESEND_API_KEY"]) {
    try {
      return env(name);
    } catch {}
  }
  throw new Error("Missing environment variable NURTURE_RESEND_API_KEY");
}

async function resend(method, path, body, idempotencyKey) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.resend.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${resendKey()}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Resend ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
}

// ---------- enroll / stop ----------
export function nurtureEligible(f) {
  if (f.Nurture || !EMAIL_RE.test(String(f.Email || "").trim())) return false;
  if (f.Status && f.Status !== "New") return false;
  const tier = String(f.Tier || "");
  return /nurture/i.test(tier) || (/cold/i.test(tier) && f["Ad Name"] === "Website");
}

export const unsubscribeUrl = (recordId) => `${NURTURE_EMAIL.siteUrl}/unsubscribe?` + new URLSearchParams({ id: recordId });

/** Queue the whole sequence for a lead. Does nothing for leads that don't qualify or are already enrolled. */
export async function enrollInNurture(rec, now = new Date()) {
  const f = rec.fields;
  if (!nurtureEligible(f)) return { skipped: "not eligible" };

  const plan = nurturePlan(now);
  const unsub = unsubscribeUrl(rec.id);
  const name = String(f["Full Name"] || "").trim().split(/\s+/)[0].slice(0, 40);
  const content = nurtureEmails({ name, call: plan.call, nextCall: plan.nextCall });
  const ids = [];
  try {
    for (const step of plan.steps) {
      const email = render(content[step.key], unsub);
      const sent = await resend("POST", "/emails", {
        from: NURTURE_EMAIL.from,
        to: [String(f.Email).trim()],
        reply_to: NURTURE_EMAIL.replyTo,
        subject: email.subject,
        text: email.text,
        html: email.html,
        scheduled_at: step.at.toISOString(),
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: [{ name: "sequence", value: "nurture" }, { name: "step", value: step.key }],
      }, `nurture-${rec.id}-${step.key}`);
      ids.push(sent.id);
    }
  } finally {
    // Save whatever got queued, even after a failure, so it can still be cancelled.
    if (ids.length) {
      await updateLead(rec.id, { Nurture: "Emails scheduled", "Info Call": plan.call.toISOString(), "Nurture Email IDs": ids.join("\n") });
    }
  }
  return { scheduled: plan.steps.map((s) => s.key), call: plan.call.toISOString() };
}

/** Cancel the emails that haven't gone out yet. `status` is "Unsubscribed" or "Stopped". */
export async function stopNurture(recordId, status) {
  const rec = await getLead(recordId);
  const f = rec.fields;
  if (f.Nurture === status || (status === "Stopped" && f.Nurture !== "Emails scheduled")) return { skipped: true };
  let cancelled = 0;
  for (const id of String(f["Nurture Email IDs"] || "").split(/\s+/).filter(Boolean)) {
    try {
      await resend("POST", `/emails/${id}/cancel`);
      cancelled++;
    } catch (err) {
      // Already sent or already cancelled is fine. A key that isn't allowed to cancel is not.
      if (/→ 40[13]:/.test(err.message)) throw err;
    }
  }
  await updateLead(rec.id, { Nurture: status });
  return { cancelled };
}
