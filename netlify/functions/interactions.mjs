// Discord interactions endpoint: buttons, dropdowns, pop-up forms, and slash commands.
import { verifySignature, json, RESPONSE, EPHEMERAL, interactionWebhook, discord, memberName } from "../../lib/discord.mjs";
import { RECRUITER_ROLE_ID, OWNER_USER_ID, LEADS_CHANNEL_ID, STAGES } from "../../lib/config.mjs";
import {
  claimLead, claimedCard, handOff, setStage, markDead, reopen, addNote, stageControls, lostReasonPicker,
  myLeads, searchLead, scoreboardEmbeds, channelUrl, isNurture, returnToMorningPool, distributeOvernightLeads,
} from "../../lib/leads.mjs";
import { getPause, pauseActive, startPause, clearPause, resumeLabel } from "../../lib/pause.mjs";
import { rotationReport } from "../../lib/rotation.mjs";
import { getLead } from "../../lib/airtable.mjs";
import { latestCall, attendancePicker, saveAttendance } from "../../lib/infocall.mjs";

const ephemeral = (content, extra = {}) => json({ type: RESPONSE.MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...extra } });

export default async (req, context) => {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"))) {
    return new Response("invalid request signature", { status: 401 });
  }
  const i = JSON.parse(raw);
  if (i.type === 1) return json({ type: RESPONSE.PONG });

  const member = i.member;
  const user = { id: member?.user?.id, name: memberName(member) };
  const isRecruiter = (member?.roles || []).includes(RECRUITER_ROLE_ID) || user.id === OWNER_USER_ID;

  try {
    if (i.type === 2) return await handleCommand(i, user, isRecruiter, context);
    if (i.type === 3) return await handleComponent(i, user, isRecruiter, context);
    if (i.type === 5) return await handleModal(i, user, context);
  } catch (err) {
    console.error(err);
    return ephemeral("Something went wrong — try again in a moment.");
  }
  return ephemeral("Unknown interaction.");
};

// ---------- buttons & dropdowns ----------
async function handleComponent(i, user, isRecruiter, context) {
  const [action, recordId] = i.data.custom_id.split(":");

  if (action === "claim") {
    if (!isRecruiter) return ephemeral("Only people with the Recruiter role can claim leads.");
    // Acknowledge now; do the slow work (channel + Airtable) after responding.
    context.waitUntil((async () => {
      try {
        const result = await claimLead(recordId, user);
        if (!result.ok) {
          await interactionWebhook("POST", i.token, "", { content: result.message, flags: EPHEMERAL });
          return;
        }
        await interactionWebhook("PATCH", i.token, "/messages/@original",
          claimedCard(result.fields, user, result.channelId, isNurture(result.fields.Tier)));
        await interactionWebhook("POST", i.token, "", {
          content: `Claimed. Your notes channel: <#${result.channelId}>`, flags: EPHEMERAL,
        });
      } catch (err) {
        console.error(err);
        await interactionWebhook("POST", i.token, "", { content: "Couldn't claim that lead — try again.", flags: EPHEMERAL });
      }
    })());
    return json({ type: RESPONSE.DEFERRED_UPDATE });
  }

  if (action === "pass") {
    const rec = await getLead(recordId);
    if (rec.fields.Claimed) return ephemeral("That lead is already claimed.");
    const pause = await getPause();
    if (pauseActive(pause)) {
      if (!rec.fields["Recruiter Discord ID"]) return ephemeral(`Nobody has this one yet. It gets handed out at ${resumeLabel(pause.until)}.`);
      if (rec.fields["Recruiter Discord ID"] !== user.id && user.id !== OWNER_USER_ID) {
        return ephemeral("Only the recruiter it's assigned to can pass it.");
      }
      context.waitUntil(returnToMorningPool(rec, pause.until).catch(console.error));
      return ephemeral(`Rotation is paused, so it goes into the ${resumeLabel(pause.until)} hand-out.`);
    }
    if (rec.fields["Recruiter Discord ID"] !== user.id && user.id !== OWNER_USER_ID) {
      return ephemeral("Only the recruiter it's assigned to can pass it.");
    }
    context.waitUntil(handOff(rec, `↪️ <@${user.id}> passed`).catch(console.error));
    return ephemeral("Passed to the next recruiter.");
  }

  if (action === "stage") {
    const value = i.data.values[0];
    context.waitUntil(setStage(recordId, value).catch(console.error));
    return json({ type: RESPONSE.UPDATE_MESSAGE, data: stageControls(recordId, value) });
  }

  if (action === "dead") {
    return json({ type: RESPONSE.MESSAGE, data: { ...lostReasonPicker(recordId), flags: EPHEMERAL } });
  }

  if (action === "lost") {
    const reason = i.data.values[0];
    context.waitUntil((async () => {
      await markDead(recordId, reason);
      const rec = await getLead(recordId);
      const menuId = rec.fields["Stage Menu ID"];
      if (menuId) await discord("PATCH", `/channels/${i.channel_id}/messages/${menuId}`, stageControls(recordId, "Dead", reason));
    })().catch(console.error));
    return json({ type: RESPONSE.UPDATE_MESSAGE, data: { content: `Marked dead — **${reason}**.`, components: [] } });
  }

  if (action === "reopen") {
    context.waitUntil((async () => {
      const status = await reopen(recordId);
      await interactionWebhook("PATCH", i.token, "/messages/@original", stageControls(recordId, status));
    })().catch(console.error));
    return json({ type: RESPONSE.DEFERRED_UPDATE });
  }

  if (action === "attended") {
    if (!isRecruiter) return ephemeral("Only people with the Recruiter role can mark attendance.");
    const menu = i.message.components.flatMap((r) => r.components).find((c) => c.custom_id === i.data.custom_id);
    const before = menu.options.map((o) => ({ value: o.value, default: Boolean(o.default) }));
    const selected = i.data.values;
    context.waitUntil((async () => {
      const { added, removed } = await saveAttendance(before, selected);
      const parts = [added && `${added} marked as attended and posted for follow-up`, removed && `${removed} unmarked`].filter(Boolean);
      await interactionWebhook("POST", i.token, "", { content: parts.length ? `Saved: ${parts.join(", ")}.` : "No changes.", flags: EPHEMERAL });
    })().catch(async (err) => {
      console.error(err);
      await interactionWebhook("POST", i.token, "", { content: "Couldn't save attendance — try again.", flags: EPHEMERAL });
    }));
    // Show the new picks as the saved state.
    const components = i.message.components.map((r) => ({
      ...r,
      components: r.components.map((c) => c.custom_id !== i.data.custom_id ? c : {
        ...c, options: c.options.map((o) => ({ ...o, default: selected.includes(o.value) })),
      }),
    }));
    return json({ type: RESPONSE.UPDATE_MESSAGE, data: { content: i.message.content, components } });
  }

  if (action === "note") {
    return json({
      type: RESPONSE.MODAL,
      data: {
        custom_id: `notemodal:${recordId}`,
        title: "Add a note",
        components: [{
          type: 1,
          components: [{
            type: 4, custom_id: "text", label: "Note", style: 2, min_length: 1, max_length: 1500, required: true,
            placeholder: "Called, left voicemail. Interested in the Colorado blitz…",
          }],
        }],
      },
    });
  }

  return ephemeral("Unknown button.");
}

// ---------- pop-up form submissions ----------
async function handleModal(i, user, context) {
  const [action, recordId] = i.data.custom_id.split(":");
  if (action === "notemodal") {
    const text = i.data.components[0].components[0].value;
    context.waitUntil(addNote(recordId, user.name, text).catch(console.error));
    return json({
      type: RESPONSE.MESSAGE,
      data: { content: `📝 **Note from ${user.name}:**\n${text}`, allowed_mentions: { parse: [] } },
    });
  }
  return ephemeral("Unknown form.");
}

// ---------- slash commands ----------
async function handleCommand(i, user, isRecruiter, context) {
  const name = i.data.name;

  if (name === "rotation") {
    context.waitUntil((async () => {
      await interactionWebhook("PATCH", i.token, "/messages/@original", { content: await rotationReport() });
    })().catch(console.error));
    return json({ type: RESPONSE.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  }

  if (name === "pause") {
    if (!isRecruiter) return ephemeral("Only people with the Recruiter role can pause lead rotation.");
    const current = await getPause();
    if (pauseActive(current)) return ephemeral(`Already paused until ${resumeLabel(current.until)}. Use /resume to hand leads out now.`);
    const until = await startPause(user.name);
    context.waitUntil(discord("POST", `/channels/${LEADS_CHANNEL_ID}/messages`, {
      content: `⏸️ **${user.name}** paused lead rotation until **${resumeLabel(until)}**. New Hot/Warm leads still post here, unassigned and with no pings. At ${resumeLabel(until)} they get handed out. \`/resume\` hands them out sooner.`,
      allowed_mentions: { parse: [] },
    }).catch(console.error));
    return ephemeral(`Paused until ${resumeLabel(until)}.`);
  }

  if (name === "resume") {
    if (!isRecruiter) return ephemeral("Only people with the Recruiter role can resume lead rotation.");
    if (!(await getPause())) return ephemeral("Lead rotation isn't paused.");
    await clearPause();
    context.waitUntil(distributeOvernightLeads(`▶️ **${user.name}** resumed lead rotation.`).catch(console.error));
    return ephemeral("Resumed. Handing out the leads that came in while it was paused.");
  }

  if (name === "infocall") {
    if (!isRecruiter) return ephemeral("Only people with the Recruiter role can mark attendance.");
    context.waitUntil((async () => {
      const call = await latestCall();
      await interactionWebhook("PATCH", i.token, "/messages/@original", call?.invitees.length
        ? attendancePicker(call)
        : { content: "No info call has started yet. Run this during or after Sunday's call." });
    })().catch(console.error));
    return json({ type: RESPONSE.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  }

  if (name === "myleads") {
    context.waitUntil((async () => {
      const leads = await myLeads(user.id);
      const lines = leads.map((r) => {
        const f = r.fields;
        const stage = STAGES.find((s) => s.value === f.Status);
        const ch = f["Notes Channel"]?.split("/").pop();
        return `${stage?.emoji ?? "🆕"} **${f["Full Name"]}** — ${f.Status || "New"}${ch ? ` · <#${ch}>` : ""}`;
      });
      await interactionWebhook("PATCH", i.token, "/messages/@original", {
        content: lines.length ? `**Your open leads (${lines.length})**\n${lines.join("\n")}`.slice(0, 1990) : "You have no open leads right now.",
      });
    })().catch(console.error));
    return json({ type: RESPONSE.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  }

  if (name === "lead") {
    const query = i.data.options?.[0]?.value ?? "";
    context.waitUntil((async () => {
      const found = await searchLead(query);
      if (!found.length) {
        await interactionWebhook("PATCH", i.token, "/messages/@original", { content: `No lead matching "${query}".` });
        return;
      }
      const f = found[0].fields;
      const notes = f.Notes ? f.Notes.slice(-900) : "No notes yet.";
      await interactionWebhook("PATCH", i.token, "/messages/@original", {
        content: found.length > 1 ? `Showing 1 of ${found.length} matches.` : "",
        embeds: [{
          title: f["Full Name"],
          color: 0x5865f2,
          fields: [
            { name: "Tier", value: f.Tier || "—", inline: true },
            { name: "Stage", value: f.Status || "New", inline: true },
            { name: "Recruiter", value: f["Assigned Recruiter"] || "—", inline: true },
            { name: "Phone", value: f.Phone || "—", inline: true },
            { name: "Email", value: f.Email || "—", inline: true },
            { name: "Lost reason", value: f["Lost Reason"] || "—", inline: true },
            { name: "Notes", value: notes },
          ],
          url: f["Notes Channel"] || undefined,
        }],
      });
    })().catch(console.error));
    return json({ type: RESPONSE.DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  }

  if (name === "scoreboard") {
    const days = i.data.options?.[0]?.value ?? 30;
    context.waitUntil((async () => {
      const embeds = await scoreboardEmbeds(days);
      await interactionWebhook("PATCH", i.token, "/messages/@original", { embeds });
    })().catch(console.error));
    return json({ type: RESPONSE.DEFERRED_MESSAGE });
  }

  return ephemeral("Unknown command.");
}

export const config = { path: "/api/interactions" };
