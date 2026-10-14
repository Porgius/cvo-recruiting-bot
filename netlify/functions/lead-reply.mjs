// pinkteamfiber.com's inbound mail function calls this with { "emailId": "<Resend received email id>" }
// for every email sent to @pinkteamfiber.com. Replies from leads go to Discord and Airtable (lib/replies.mjs).
// Responds right away and does the work in the background.
import { handleLeadReply } from "../../lib/replies.mjs";
import { json } from "../../lib/discord.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body = {};
  try { body = await req.json(); } catch {}
  const id = String(body.emailId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "emailId required" }, 400);
  context.waitUntil(
    handleLeadReply(id).then(
      (r) => console.log("lead reply", id, JSON.stringify(r)),
      (err) => console.error("lead reply failed", id, err),
    ),
  );
  return json({ accepted: true }, 202);
};

export const config = { path: "/api/lead-reply" };
