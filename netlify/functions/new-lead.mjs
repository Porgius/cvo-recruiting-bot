// Called by Make right after a Meta lead is saved to Airtable: { "recordId": "rec..." }.
// Safe to call twice — a lead that already has a Discord post is skipped.
// { "recordId": "rec...", "nurtureOnly": true } only sends the nurture emails (for older leads).
import { postNewLead, enrollExistingLead } from "../../lib/leads.mjs";
import { json } from "../../lib/discord.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body = {};
  try { body = await req.json(); } catch {}
  const id = String(body.recordId || "");
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return json({ error: "recordId required" }, 400);
  try {
    return json(body.nurtureOnly === true ? await enrollExistingLead(id) : await postNewLead(id));
  } catch (err) {
    console.error(err);
    return json({ error: "failed" }, 500);
  }
};

export const config = { path: "/api/new-lead" };
