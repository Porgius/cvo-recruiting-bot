import {
  GUILD_ID, LEADS_CHANNEL_ID, NURTURE_CHANNEL_ID, NOTES_CATEGORY_ID, OWNER_USER_ID, RECRUITER_ROLE_ID,
  STAGES, LOST_REASONS, MAX_HANDOFFS, SPEND_TABLE_ID, env,
} from "./config.mjs";
import { discord, listRecruiters, slug } from "./discord.mjs";
import { getLead, updateLead, updateLeads, findLeads, findRecords } from "./airtable.mjs";
import { enrollInNurture, stopNurture, isWebsiteLead, sendWelcome } from "./nurture.mjs";
import { getPause, pauseActive, resumeLabel } from "./pause.mjs";
import { takeTurns } from "./rotation.mjs";

// ---------- formatting ----------
const dash = (v) => (v === undefined || v === null || v === "" ? "—" : String(v));
export const isHotWarm = (tier) => /hot|warm/i.test(tier || "");
export const isHot = (tier) => /hot/i.test(tier || "");
export const isNurture = (tier) => /nurture/i.test(tier || "");

export function leadEmbed(f, color) {
  return {
    title: f["Full Name"] || "New lead",
    color,
    fields: [
      { name: "📞 Phone", value: dash(f.Phone), inline: true },
      { name: "✉️ Email", value: dash(f.Email), inline: true },
      { name: "🏭 Industry", value: dash(f["Previous Industry"]), inline: true },
      { name: "📅 Experience", value: dash(f["Years Raw"]), inline: true },
      { name: "💰 Last season", value: dash(f["Estimated Earnings"]), inline: true },
      { name: "✈️ Blitz", value: dash(f["Open to Blitz"]), inline: true },
      { name: "📊 Score", value: `${dash(f["Lead Score"])}/100`, inline: true },
      { name: "📣 Ad", value: dash(f["Ad Name"]), inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

export const button = (style, label, custom_id, emoji) => ({ type: 2, style, label, custom_id, ...(emoji ? { emoji: { name: emoji } } : {}) });
const linkButton = (label, url) => ({ type: 2, style: 5, label, url });
export const row = (...components) => ({ type: 1, components });

export const channelUrl = (channelId) => `https://discord.com/channels/${GUILD_ID}/${channelId}`;

// Who gets each lead: lib/rotation.mjs (takeTurns).

// ---------- new lead ----------
// Rookies and Nurture leads also get emailed into the weekly Zoom info call (lib/nurture.mjs).
// An email problem never blocks the Discord post.
async function nurture(rec) {
  try {
    return await enrollInNurture(rec);
  } catch (err) {
    console.error("nurture emails failed", rec.id, err);
    return { error: String(err.message || err) };
  }
}

/** Nurture emails only, no Discord post. For leads that came in before the emails existed. */
export async function enrollExistingLead(recordId) {
  return { nurture: await nurture(await getLead(recordId)) };
}

export async function postNewLead(recordId) {
  const rec = await getLead(recordId);
  const f = rec.fields;
  // Calling again for a posted lead still enrolls it in the nurture emails if it qualifies.
  if (f["Discord Message ID"]) return { skipped: "already posted", nurture: await nurture(rec) };

  if (isHotWarm(f.Tier)) {
    const pause = await getPause();
    if (pauseActive(pause)) {
      // Overnight pause: post it unassigned, no ping. It's dealt out at 10 AM (distributeOvernightLeads).
      const msg = await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
        content: `**New ${f.Tier} lead** (rotation paused). It gets handed out at ${resumeLabel(pause.until)}. Anyone can claim it before then.`,
        embeds: [leadEmbed(f, isHot(f.Tier) ? 0xed4245 : 0xe67e22)],
        components: [row(button(3, "Claim", `claim:${rec.id}`, "✅"), button(2, "Pass", `pass:${rec.id}`, "↪️"))],
        allowed_mentions: { parse: [] },
      });
      await updateLead(rec.id, {
        "Discord Message ID": msg.id, "Alert Sent": true, "Assigned Recruiter": "", "Recruiter Discord ID": "", "Reassign Count": 0,
      });
    } else {
      const [r] = await takeTurns("new");
      const msg = await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
        content: r
          ? `**New ${f.Tier} lead** → <@${r.id}>\nTap **Claim** within 15 min or it moves to the next recruiter.`
          : `**New ${f.Tier} lead** — no one has the Recruiter role yet.`,
        embeds: [leadEmbed(f, isHot(f.Tier) ? 0xed4245 : 0xe67e22)],
        components: [row(button(3, "Claim", `claim:${rec.id}`, "✅"), button(2, "Pass", `pass:${rec.id}`, "↪️"))],
        allowed_mentions: { users: r ? [r.id] : [] },
      });
      await updateLead(rec.id, {
        "Discord Message ID": msg.id,
        "Alert Sent": true,
        "Assigned Recruiter": r?.name ?? "",
        "Recruiter Discord ID": r?.id ?? "",
        "Assigned At": new Date().toISOString(),
        "Reassign Count": 0,
      });
    }
    // Facebook leads get a heads-up email so the recruiter's call isn't from a stranger.
    // (Website applicants already got "Got your application" from the site.)
    const welcome = await sendWelcome(rec, new Date(), { morning: pauseActive(pause) }).catch((err) => {
      console.error("welcome email failed", rec.id, err);
      return { error: String(err.message || err) };
    });
    return { posted: "hot/warm", welcome };
  }

  // Website rookies (Cold: new to door-to-door) go here too, so a recruiter sees them and can text them.
  const rookie = !isNurture(f.Tier) && isWebsiteLead(f);
  if (isNurture(f.Tier) || rookie) {
    const msg = await discord("POST", `/channels/${NURTURE_CHANNEL_ID}/messages`, {
      content: rookie
        ? "🌱 **New rookie from the website** (new to door-to-door). They get the Sunday info call emails. Grab it if you have time to text them."
        : "🌱 **New Nurture lead** — not assigned. They get the Sunday info call emails. Grab it if you have downtime.",
      embeds: [leadEmbed(f, 0x57f287)],
      components: [row(button(3, "Grab it", `claim:${rec.id}`, "✅"))],
    });
    await updateLead(rec.id, { "Discord Message ID": msg.id, "Alert Sent": true });
    return { posted: rookie ? "rookie" : "nurture", nurture: await nurture(rec) };
  }

  await updateLead(rec.id, { "Alert Sent": true });
  return { skipped: "cold", nurture: await nurture(rec) };
}

// ---------- updates about a lead (email replies, info call attendance) ----------
/**
 * Post where the right person sees it: the notes channel if the lead is claimed, the lead's post in
 * #recruiting-leads if it's an unclaimed Hot/Warm lead, otherwise #nurture-leads with a Grab it button.
 */
export async function postLeadUpdate(rec, text, { pingRecruiters = false, grab = true } = {}) {
  const f = rec.fields;
  const owner = f["Recruiter Discord ID"];
  const notesId = f.Claimed ? String(f["Notes Channel"] || "").split("/").pop() : "";
  if (notesId) {
    try {
      return await discord("POST", `/channels/${notesId}/messages`, {
        content: `${owner ? `<@${owner}> ` : ""}${text}`,
        allowed_mentions: { users: owner ? [owner] : [] },
      });
    } catch (err) {
      console.error("notes channel post failed, using #nurture-leads", rec.id, err); // channel deleted
    }
  }
  if (!f.Claimed && isHotWarm(f.Tier) && f["Discord Message ID"]) {
    return discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
      content: `${owner ? `<@${owner}> ` : ""}${text}`,
      message_reference: { message_id: f["Discord Message ID"], fail_if_not_exists: false },
      allowed_mentions: { users: owner ? [owner] : [] },
    });
  }
  return discord("POST", `/channels/${NURTURE_CHANNEL_ID}/messages`, {
    content: `${pingRecruiters ? `<@&${RECRUITER_ROLE_ID}> ` : ""}${text}`,
    embeds: [leadEmbed(f, 0x57f287)],
    components: grab && !f.Claimed ? [row(button(3, "Grab it", `claim:${rec.id}`, "✅"))] : [],
    allowed_mentions: { roles: pingRecruiters ? [RECRUITER_ROLE_ID] : [] },
  });
}

// ---------- notes channel controls ----------
export function stageControls(recordId, status, lostReason) {
  const rank = STAGES.find((s) => s.value === status)?.rank ?? 0;
  const dead = status === "Dead";
  const header = dead
    ? `**❌ Dead** — ${lostReason || "reason not set"}`
    : `**📊 Stage:** ${status && status !== "New" ? `${STAGES.find((s) => s.value === status)?.emoji ?? ""} ${status}` : "New — not contacted yet"}`;
  return {
    content: header,
    components: dead
      ? [row(button(2, "Reopen lead", `reopen:${recordId}`, "↩️"), button(1, "Add note", `note:${recordId}`, "📝"))]
      : [
          row({
            type: 3,
            custom_id: `stage:${recordId}`,
            placeholder: "Update stage…",
            options: STAGES.map((s) => ({
              label: s.label, value: s.value, emoji: { name: s.emoji }, default: s.value === status,
              description: s.rank < rank ? "done" : undefined,
            })),
          }),
          row(button(1, "Add note", `note:${recordId}`, "📝"), button(4, "Mark dead", `dead:${recordId}`, "❌")),
        ],
  };
}

export function lostReasonPicker(recordId) {
  return {
    content: "Why didn't it convert?",
    components: [row({
      type: 3,
      custom_id: `lost:${recordId}`,
      placeholder: "Pick a reason…",
      options: LOST_REASONS.map((r) => ({ label: r.value, value: r.value, emoji: { name: r.emoji } })),
    })],
  };
}

// ---------- claim ----------
const CHANNEL_PERMS = 1024 + 2048 + 16384 + 65536 + 64; // 85056

export async function claimLead(recordId, user) {
  const rec = await getLead(recordId);
  const f = rec.fields;
  if (f.Claimed) {
    return { ok: false, message: `Already claimed by **${f["Assigned Recruiter"] || "someone"}**.` };
  }

  const channel = await discord("POST", `/guilds/${GUILD_ID}/channels`, {
    name: `notes-${slug(f["Full Name"])}`,
    type: 0,
    parent_id: NOTES_CATEGORY_ID,
    topic: `Private recruiting notes for ${f["Full Name"] || "lead"}`,
    permission_overwrites: [
      { id: GUILD_ID, type: 0, allow: "0", deny: "1024" },
      // View, Send, Embed Links, Read History, Add Reactions. Must be a subset of the bot's own
      // server permissions, or Discord rejects the channel with "Missing Permissions".
      { id: user.id, type: 1, allow: String(CHANNEL_PERMS), deny: "0" },
      { id: env("DISCORD_APP_ID"), type: 1, allow: String(CHANNEL_PERMS), deny: "0" },
    ],
  });

  await discord("POST", `/channels/${channel.id}/messages`, {
    content: `📝 <@${user.id}> this is your private notes channel for **${f["Full Name"] || "this lead"}**. Use the controls below to log progress — everything saves to Airtable instantly.`,
    embeds: [leadEmbed(f, 0x5865f2)],
    allowed_mentions: { users: [user.id] },
  });
  if (f.Notes) {
    await discord("POST", `/channels/${channel.id}/messages`, {
      content: `**Notes so far**\n${f.Notes.length > 1800 ? "…" + f.Notes.slice(-1800) : f.Notes}`,
      allowed_mentions: { parse: [] },
    });
  }
  const controls = await discord("POST", `/channels/${channel.id}/messages`, stageControls(rec.id, f.Status, f["Lost Reason"]));

  await updateLead(rec.id, {
    Claimed: true,
    "Assigned Recruiter": user.name,
    "Recruiter Discord ID": user.id,
    "Notes Channel": channelUrl(channel.id),
    "Stage Menu ID": controls.id,
  });
  return { ok: true, channelId: channel.id, fields: f };
}

export function claimedCard(fields, user, channelId, isNurtureLead) {
  return {
    content: `✅ **Claimed by <@${user.id}>**${isNurtureLead ? " (nurture)" : ""}`,
    embeds: [leadEmbed(fields, 0x2b2d31)],
    components: [row(linkButton("Open notes", channelUrl(channelId)))],
    allowed_mentions: { parse: [] },
  };
}

// ---------- hand off to the next recruiter ----------
export async function handOff(rec, reason) {
  const f = rec.fields;
  const [r] = await takeTurns("handoff", 1, f["Recruiter Discord ID"]);
  if (!r) return null;
  const msgId = f["Discord Message ID"];
  await discord("PATCH", `/channels/${LEADS_CHANNEL_ID}/messages/${msgId}`, {
    content: `**${f.Tier} lead** → <@${r.id}>\nTap **Claim** within 15 min or it moves to the next recruiter.`,
    allowed_mentions: { parse: [] },
  });
  await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
    content: `${reason} → <@${r.id}> **${f["Full Name"]}** is yours now — tap **Claim** on the lead above.`,
    message_reference: { message_id: msgId, fail_if_not_exists: false },
    allowed_mentions: { users: [r.id] },
  });
  await updateLead(rec.id, {
    "Assigned Recruiter": r.name,
    "Recruiter Discord ID": r.id,
    "Assigned At": new Date().toISOString(),
    "Reassign Count": Number(f["Reassign Count"] || 0) + 1,
  });
  return r;
}

// ---------- overnight pause (lib/pause.mjs) ----------
const leadLink = (f) => `[${String(f["Full Name"] || "Lead").replace(/[[\]]/g, "")}](https://discord.com/channels/${GUILD_ID}/${LEADS_CHANNEL_ID}/${f["Discord Message ID"]})`;

/** Pass while paused: the lead goes back into the 10 AM hand-out instead of pinging someone overnight. */
export async function returnToMorningPool(rec, until) {
  await updateLead(rec.id, { "Assigned Recruiter": "", "Recruiter Discord ID": "" });
  await discord("PATCH", `/channels/${LEADS_CHANNEL_ID}/messages/${rec.fields["Discord Message ID"]}`, {
    content: `**${rec.fields.Tier} lead** (rotation paused). It gets handed out at ${resumeLabel(until)}. Anyone can claim it before then.`,
    allowed_mentions: { parse: [] },
  });
}

/**
 * The morning hand-out: deal unassigned Hot/Warm leads out round-robin (Hot first, oldest first), give
 * leads that were already waiting on someone a fresh 15 minutes, and post one summary tagging everyone.
 */
export async function distributeOvernightLeads(headline) {
  const base = `AND({Alert Sent}, NOT({Claimed}), {Status} = "New", {F HotWarm} = 1, {Discord Message ID} != ""`;
  const waiting = await findLeads(`${base}, {Recruiter Discord ID} = "")`);
  const alreadyOut = await findLeads(`${base}, {Recruiter Discord ID} != "", {Reassign Count} < ${MAX_HANDOFFS})`);
  const recruiters = await listRecruiters();
  if (!recruiters.length && waiting.length) {
    await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
      content: `${headline}\n${waiting.length} lead(s) are waiting, but no one has the Recruiter role yet.`,
      allowed_mentions: { parse: [] },
    });
    return { handedOut: 0, refreshed: 0 };
  }

  waiting.sort((a, b) => (isHot(b.fields.Tier) - isHot(a.fields.Tier)) || Date.parse(a.createdTime) - Date.parse(b.createdTime));
  const turns = await takeTurns("new", waiting.length);
  const now = new Date().toISOString();
  const byRecruiter = new Map(); // discord id → lines
  const add = (id, line) => byRecruiter.set(id, [...(byRecruiter.get(id) || []), line]);
  const updates = [];
  const dealt = [];
  waiting.forEach((rec, i) => {
    const r = turns[i];
    updates.push({ id: rec.id, fields: { "Assigned Recruiter": r.name, "Recruiter Discord ID": r.id, "Assigned At": now, "Reassign Count": 0 } });
    dealt.push({ rec, r });
    add(r.id, `${leadLink(rec.fields)} (${rec.fields.Tier})`);
  });
  // Assigned before the pause and still unclaimed: restart their clock rather than hand them off at 10:00 sharp.
  for (const rec of alreadyOut) {
    updates.push({ id: rec.id, fields: { "Assigned At": now } });
    add(rec.fields["Recruiter Discord ID"], `${leadLink(rec.fields)} (${rec.fields.Tier}, still yours)`);
  }
  await updateLeads(updates);

  // Point each overnight post at its recruiter. No ping here; the summary below does that.
  for (const { rec, r } of dealt.slice(0, 20)) {
    await discord("PATCH", `/channels/${LEADS_CHANNEL_ID}/messages/${rec.fields["Discord Message ID"]}`, {
      content: `**${rec.fields.Tier} lead** → <@${r.id}>\nTap **Claim** within 15 min or it moves to the next recruiter.`,
      allowed_mentions: { parse: [] },
    }).catch((err) => console.error("couldn't update overnight post", rec.id, err));
  }

  const lines = [...byRecruiter].map(([id, leads]) => `<@${id}>: ${leads.join(", ")}`);
  const intro = waiting.length
    ? `${headline}\n${waiting.length} lead(s) came in while rotation was paused. Tap **Claim** on yours within 15 minutes.`
    : `${headline}\nNo new leads came in while rotation was paused.`;
  const chunks = [intro];
  for (const line of lines) {
    if (chunks.at(-1).length + line.length + 1 > 1900) chunks.push(line);
    else chunks[chunks.length - 1] += `\n${line}`;
  }
  for (const content of chunks) {
    await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
      content,
      allowed_mentions: { users: [...byRecruiter.keys()].slice(0, 100) },
    });
  }
  return { handedOut: waiting.length, refreshed: alreadyOut.length };
}

export async function staleUnclaimedLeads() {
  return findLeads(
    `AND({Alert Sent}, NOT({Claimed}), {Recruiter Discord ID} != "", {Discord Message ID} != "", {Status} = "New", ` +
      `{F HotWarm} = 1, {Reassign Count} < ${MAX_HANDOFFS}, DATETIME_DIFF(NOW(), {Assigned At}, "minutes") >= 15)`,
  );
}

// ---------- stage updates ----------
export async function setStage(recordId, newStatus) {
  const rec = await getLead(recordId);
  const f = rec.fields;
  const target = STAGES.find((s) => s.value === newStatus);
  const fields = { Status: newStatus };
  // Fill this stage's date and any earlier stage dates that were skipped.
  for (const s of STAGES) if (s.rank <= target.rank && !f[s.dateField]) fields[s.dateField] = new Date().toISOString();
  await updateLead(rec.id, fields);

  const newlyHired = target.rank >= 4 && !f["Hired At"];
  if (target.rank >= 4) await stopNurture(rec.id, "Stopped").catch((err) => console.error("stop nurture", rec.id, err));
  if (newlyHired) {
    await discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
      content: `🤝 **${f["Full Name"]}** was marked **${newStatus}** by <@${f["Recruiter Discord ID"]}>.\n<@${OWNER_USER_ID}> the rep agreement needs to go out if it hasn't.`,
      allowed_mentions: { users: [OWNER_USER_ID] },
    });
  }
  return f;
}

export async function markDead(recordId, reason) {
  await updateLead(recordId, { Status: "Dead", "Lost Reason": reason });
  await stopNurture(recordId, "Stopped").catch((err) => console.error("stop nurture", recordId, err));
}

export async function reopen(recordId) {
  const rec = await getLead(recordId);
  const f = rec.fields;
  const lastStage = [...STAGES].reverse().find((s) => f[s.dateField]);
  const status = lastStage?.value ?? "New";
  await updateLead(recordId, { Status: status, "Lost Reason": null });
  return status;
}

export async function addNote(recordId, author, text) {
  const rec = await getLead(recordId);
  const stamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
  const prev = rec.fields.Notes ? rec.fields.Notes + "\n\n" : "";
  await updateLead(recordId, { Notes: `${prev}[${stamp}] ${author}: ${text}` });
}

// ---------- reporting ----------
export async function myLeads(userId) {
  return findLeads(
    `AND({Recruiter Discord ID} = "${userId}", {Claimed}, {Status} != "Dead", {Status} != "On Doors")`,
  );
}

export async function searchLead(name) {
  const safe = String(name).replace(/"/g, "");
  return findLeads(`FIND(LOWER("${safe}"), LOWER({Full Name}))`);
}

export async function scoreboardEmbeds(days = 30) {
  const leads = await findLeads(`IS_AFTER({Submitted}, DATEADD(NOW(), -${days}, "days"))`);
  const spendRows = await findRecords(SPEND_TABLE_ID, `IS_AFTER({Week Of}, DATEADD(TODAY(), -${days + 1}, "days"))`);
  const spend = spendRows.reduce((s, r) => s + Number(r.fields.Amount || 0), 0);
  const sum = (arr, k) => arr.reduce((s, r) => s + Number(r.fields[k] || 0), 0);
  const n = leads.length;
  const hired = sum(leads, "F Hired");
  const doors = sum(leads, "F On Doors");
  const money = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const per = (d) => (d > 0 && spend > 0 ? money(spend / d) : "—");
  const dead = leads.filter((r) => r.fields.Status === "Dead");
  const reasonCount = (v) => dead.filter((r) => r.fields["Lost Reason"] === v).length;

  const funnel =
    `📥 **Leads:** ${n}  ·  🔥 **Hot/Warm:** ${sum(leads, "F HotWarm")}\n\n` +
    `**Funnel**\n✅ Claimed: **${sum(leads, "F Claimed")}**\n📞 Contacted: **${sum(leads, "F Contacted")}**\n` +
    `📅 Interview booked: **${sum(leads, "F Booked")}**\n🎤 Interviewed: **${sum(leads, "F Interviewed")}**\n` +
    `🤝 Hired: **${hired}**\n📜 Agreement signed: **${sum(leads, "F Signed")}**\n🚪 **On doors: ${doors}**\n\n` +
    `**Why leads died** (${dead.length})\n` +
    LOST_REASONS.map((r) => `${r.emoji} ${r.value} ${reasonCount(r.value)}`).join(" · ") +
    `\n\n**Cost** (ad spend logged: ${money(spend)})\nPer lead: ${per(n)} · Per hire: ${per(hired)} · **Per rep on doors: ${per(doors)}**` +
    (spend === 0 ? "\n\n⚠️ No ad spend logged — add weekly totals to the Ad Spend table in Airtable." : "");

  const groupLines = (key, fmt) => {
    const groups = new Map();
    for (const r of leads) {
      const k = r.fields[key] || null;
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return [...groups.entries()].map(([k, rs]) => fmt(k, rs)).join("\n") || "—";
  };
  const byRecruiter = groupLines("Assigned Recruiter", (k, rs) =>
    `**${k}** — claimed ${sum(rs, "F Claimed")} · contacted ${sum(rs, "F Contacted")} · hired ${sum(rs, "F Hired")} · on doors **${sum(rs, "F On Doors")}**`);
  const byAd = groupLines("Ad Name", (k, rs) =>
    `**${k}** — leads ${rs.length} · hot/warm ${sum(rs, "F HotWarm")} · hired ${sum(rs, "F Hired")} · on doors **${sum(rs, "F On Doors")}**`);

  return [
    { title: `Recruiting funnel — last ${days} days`, description: funnel.slice(0, 4000), color: 0xe91e63 },
    { title: "By recruiter", description: byRecruiter.slice(0, 4000), color: 0x5865f2 },
    { title: "By ad", description: byAd.slice(0, 4000), color: 0x3498db },
  ];
}
