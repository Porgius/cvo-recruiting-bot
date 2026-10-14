// Email replies from leads → Discord + Airtable.
//
// pinkteamfiber.com's inbound mail function (pinkteamfiber-site/netlify/functions/inbound-email.mts)
// forwards every email sent to @pinkteamfiber.com to the recruiting inbox, then sends its Resend ID to
// /api/lead-reply. We fetch the email from Resend ourselves, so a made-up request can't fake a reply.
// If the sender is a lead:
//   - "STOP", "unsubscribe", "not interested"… cancels their nurture emails
//   - the reply is posted for the recruiter (lib/leads.mjs postLeadUpdate); a YES pings @Recruiter
//   - it's added to Notes, and Replied At is set
import { getStore } from "@netlify/blobs";
import { TIMEZONE } from "./config.mjs";
import { findLeads, updateLead, q } from "./airtable.mjs";
import { resend, stopNurture } from "./nurture.mjs";
import { postLeadUpdate } from "./leads.mjs";

/** "Jordan Smith <jordan@x.com>" → "jordan@x.com" */
export const senderAddress = (from) => (String(from || "").match(/<([^>]+)>/)?.[1] ?? String(from || "")).trim().toLowerCase();

const htmlToText = (html) =>
  String(html || "")
    .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<blockquote[\s\S]*$/i, "") // quoted thread
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

/** Just what they wrote: drops the quoted thread and phone signatures. */
export function replyText(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith(">")) break;
    // Gmail/Apple: "On Tue, Oct 13, 2026 at 3:10 PM Pink Team Fiber <apply@…> wrote:" (sometimes split over 2 lines)
    if (/^On\s.+/i.test(line) && /wrote:\s*$/i.test(`${line} ${(lines[i + 1] || "").trim()}`)) break;
    if (/^-{2,}\s*(Original|Forwarded) Message/i.test(line) || /^_{5,}$/.test(line)) break;
    if (/^From:\s/i.test(line)) break; // Outlook
    if (/^Sent from my /i.test(line) || /^Get Outlook for /i.test(line)) break;
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1200);
}

/** "yes", "stop" or "reply", from the first line they wrote. */
export function replyIntent(text) {
  const first = (text.split("\n").find((l) => l.trim()) || "").trim();
  if (/^(stop|unsubscribe|remove me|take me off|not interested|no thanks|no thank you)\b/i.test(first)) return "stop";
  if (/^(yes|yeah|yep|yup|ya|y|sure|i'?m in|interested|count me in|absolutely|definitely|let'?s go)\b/i.test(first)) return "yes";
  return "reply";
}

export async function handleLeadReply(emailId) {
  // Resend retries webhooks, so the same email can arrive twice.
  const seen = getStore("bot-state");
  if (await seen.get(`reply:${emailId}`)) return { skipped: "already handled" };

  const email = await resend("GET", `/emails/receiving/${encodeURIComponent(emailId)}`);
  const from = senderAddress(email.from);
  if (!from || from.endsWith("@pinkteamfiber.com")) return { skipped: "not from a lead" };

  const matches = await findLeads(`LOWER({Email}) = ${q(from)}`);
  if (!matches.length) return { skipped: "sender is not a lead" };
  const rec = matches.sort((a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime))[0];
  const f = rec.fields;

  const said = replyText(email.text || htmlToText(email.html));
  const intent = replyIntent(said);
  await seen.set(`reply:${emailId}`, "1");

  if (intent === "stop") await stopNurture(rec.id, "Unsubscribed").catch((err) => console.error("stop nurture", rec.id, err));

  const stamp = new Date().toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" });
  await updateLead(rec.id, {
    "Replied At": new Date().toISOString(),
    Notes: `${f.Notes ? f.Notes + "\n\n" : ""}[${stamp}] Email reply${email.subject ? ` (${email.subject})` : ""}: ${said || "(no text)"}`,
  });

  const name = f["Full Name"] || from;
  const headline = {
    yes: `🙌 **${name}** replied **YES** by email`,
    stop: `🛑 **${name}** asked us to stop emailing (info call emails cancelled)`,
    reply: `📬 **${name}** replied by email`,
  }[intent];
  const quote = said ? said.split("\n").map((l) => `> ${l}`).join("\n").slice(0, 1500) : "> (no text)";
  await postLeadUpdate(rec, `${headline}:\n${quote}`, { pingRecruiters: intent === "yes", grab: intent !== "stop" });

  return { lead: rec.id, intent };
}
