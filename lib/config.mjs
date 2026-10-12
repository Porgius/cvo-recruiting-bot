// Non-secret IDs for the CVO Discord server and the CVO Recruiting Airtable base.
// Secrets (bot token, Airtable token) come from Netlify environment variables.
export const GUILD_ID = "1558341320601243661";
export const RECRUITER_ROLE_ID = "1558956398841434162";
export const LEADS_CHANNEL_ID = "1558956399814385765"; // #recruiting-leads
export const NURTURE_CHANNEL_ID = "1558956400703705179"; // #nurture-leads
export const NOTES_CATEGORY_ID = "1558961698164047887"; // "Lead Notes" category
export const OWNER_USER_ID = "1331768004026826834"; // lieyuh_eft — pinged on hires

export const AIRTABLE_BASE_ID = "appusVSl7vQ5upb40";
export const LEADS_TABLE_ID = "tblDvFEmxfLaCkhaw";
export const SPEND_TABLE_ID = "tblLVWAKBdxv8QseK";

export const CLAIM_WINDOW_MINUTES = 15;
export const MAX_HANDOFFS = 3;
export const TIMEZONE = "America/New_York";
export const REASSIGN_HOURS = { start: 8, end: 22 }; // only hand off leads between 8am and 10pm ET

// Pipeline stages, in order. "rank" lets stages only move forward.
export const STAGES = [
  { value: "Contacted", label: "Contacted", emoji: "📞", rank: 1, dateField: "Contacted At" },
  { value: "Interview Booked", label: "Interview booked", emoji: "📅", rank: 2, dateField: "Booked At" },
  { value: "Interviewed", label: "Interviewed", emoji: "🎤", rank: 3, dateField: "Interviewed At" },
  { value: "Hired", label: "Hired", emoji: "🤝", rank: 4, dateField: "Hired At" },
  { value: "Agreement Signed", label: "Agreement signed", emoji: "📜", rank: 5, dateField: "Signed At" },
  { value: "On Doors", label: "On doors (worked first blitz day)", emoji: "🚪", rank: 6, dateField: "On Doors At" },
];

export const LOST_REASONS = [
  { value: "No answer", emoji: "🔇" },
  { value: "Not interested", emoji: "👎" },
  { value: "Not a fit", emoji: "🚫" },
  { value: "No-show to interview", emoji: "👻" },
  { value: "Ghosted after hire", emoji: "💨" },
  { value: "Failed background", emoji: "🛑" },
];

export function env(name) {
  const v = globalThis.Netlify?.env?.get(name) ?? process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
