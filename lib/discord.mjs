import crypto from "node:crypto";
import { env, GUILD_ID, RECRUITER_ROLE_ID } from "./config.mjs";

const API = "https://discord.com/api/v10";

// ---- Request signature check (Discord requires this on the interactions endpoint)
export function verifySignature(rawBody, signature, timestamp) {
  if (!signature || !timestamp) return false;
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(env("DISCORD_PUBLIC_KEY"), "hex"),
    ]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ---- Bot REST calls (retries once on rate limit)
export async function discord(method, path, body, attempt = 0) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}`,
      "Content-Type": "application/json",
      "User-Agent": "CVO Recruiting Bot (netlify, 1.0)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 3) {
    const data = await res.json().catch(() => ({}));
    await sleep(Math.ceil((data.retry_after ?? 1) * 1000) + 100);
    return discord(method, path, body, attempt + 1);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Discord ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

// Interaction webhook calls (edit the original response, send follow-ups). No bot token needed.
// Retries "Unknown Webhook" (404): background work can start before Discord has registered our
// initial response, so the first follow-up occasionally arrives too early.
export async function interactionWebhook(method, token, suffix, body, attempt = 0) {
  const res = await fetch(`${API}/webhooks/${env("DISCORD_APP_ID")}/${token}${suffix}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if ((res.status === 404 || res.status === 429) && attempt < 3) {
    await sleep(600 * (attempt + 1));
    return interactionWebhook(method, token, suffix, body, attempt + 1);
  }
  if (!res.ok) console.error("interaction webhook failed", res.status, await res.text());
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Server helpers
export async function listRecruiters() {
  const members = await discord("GET", `/guilds/${GUILD_ID}/members?limit=1000`);
  return members
    .filter((m) => !m.user?.bot && (m.roles || []).includes(RECRUITER_ROLE_ID))
    .map((m) => ({ id: m.user.id, name: m.nick || m.user.global_name || m.user.username }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function memberName(member) {
  return member?.nick || member?.user?.global_name || member?.user?.username || "unknown";
}

export function slug(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "lead";
}

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// Interaction response types
export const RESPONSE = {
  PONG: 1,
  MESSAGE: 4,
  DEFERRED_MESSAGE: 5,
  DEFERRED_UPDATE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
};
export const EPHEMERAL = 64;
