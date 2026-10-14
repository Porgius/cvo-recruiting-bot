// /infocall: during or after the Sunday Zoom, tick off who showed up.
// Sets Attended Call in Airtable and posts each new attendee for follow-up (lib/leads.mjs postLeadUpdate).
import { TIMEZONE } from "./config.mjs";
import { findLeads, updateLeads } from "./airtable.mjs";
import { postLeadUpdate } from "./leads.mjs";

const MENU_SIZE = 25; // Discord's limit per dropdown; a message holds 5 dropdowns
const when = (d) => d.toLocaleString("en-US", { timeZone: TIMEZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Everyone invited to the most recent call that has started (or starts within the hour). */
export async function latestCall() {
  const leads = await findLeads(`AND({Info Call}, IS_BEFORE({Info Call}, DATEADD(NOW(), 1, "hours")))`);
  if (!leads.length) return null;
  const latest = Math.max(...leads.map((r) => Date.parse(r.fields["Info Call"])));
  const invitees = leads
    .filter((r) => Date.parse(r.fields["Info Call"]) === latest)
    .sort((a, b) => String(a.fields["Full Name"] || "").localeCompare(String(b.fields["Full Name"] || "")));
  return { call: new Date(latest), invitees };
}

export function attendancePicker({ call, invitees }) {
  const shown = invitees.slice(0, MENU_SIZE * 5);
  const menus = [];
  for (let i = 0; i < shown.length; i += MENU_SIZE) menus.push(shown.slice(i, i + MENU_SIZE));
  return {
    content:
      `**Info call, ${when(call)} ET**: ${invitees.length} invited. Pick everyone who showed up. ` +
      `New attendees get posted for follow-up.` +
      (invitees.length > shown.length ? ` (Showing the first ${shown.length}.)` : ""),
    components: menus.map((menu, n) => ({
      type: 1,
      components: [{
        type: 3,
        custom_id: `attended:${call.getTime()}:${n}`,
        placeholder: menus.length > 1 ? `Who showed up? (${n * MENU_SIZE + 1}–${n * MENU_SIZE + menu.length})` : "Who showed up?",
        min_values: 0,
        max_values: menu.length,
        options: menu.map((r) => ({
          label: String(r.fields["Full Name"] || r.fields.Email || r.id).slice(0, 100),
          value: r.id,
          description: [r.fields.Email, r.fields.Phone].filter(Boolean).join(" · ").slice(0, 100) || undefined,
          default: Boolean(r.fields["Attended Call"]),
        })),
      }],
    })),
  };
}

/**
 * Save one dropdown. `options` are the dropdown's options as Discord sent them back (their `default`
 * is what was saved before), `selected` the record IDs picked now.
 */
export async function saveAttendance(options, selected) {
  const picked = new Set(selected);
  const changed = options.filter((o) => Boolean(o.default) !== picked.has(o.value));
  if (!changed.length) return { added: 0, removed: 0 };
  await updateLeads(changed.map((o) => ({ id: o.value, fields: { "Attended Call": picked.has(o.value) } })));

  const added = changed.filter((o) => picked.has(o.value)).map((o) => o.value);
  if (added.length) {
    const recs = await findLeads(`OR(${added.map((id) => `RECORD_ID() = "${id}"`).join(", ")})`);
    for (const rec of recs) {
      await postLeadUpdate(rec, `🎤 **${rec.fields["Full Name"] || "This lead"}** came to the Sunday info call. Follow up while it's fresh.`)
        .catch((err) => console.error("attendance post failed", rec.id, err));
    }
  }
  return { added: added.length, removed: changed.length - added.length };
}
