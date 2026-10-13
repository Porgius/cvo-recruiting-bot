// "Apple or Outlook" calendar link in the nurture invite (lib/nurture.mjs), proxied from
// pinkteamfiber.com/info-call.ics?t=<call start ISO>. Returns a one-event calendar file.
import { infoCallIcs } from "../../lib/nurture.mjs";

export default async (req) => {
  const t = new Date(new URL(req.url).searchParams.get("t") || "");
  const days = (t - Date.now()) / 86400e3;
  if (Number.isNaN(t.getTime()) || days < -2 || days > 60) return new Response("Unknown call time", { status: 400 });
  return new Response(infoCallIcs(t), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="pink-team-info-call.ics"',
      "Cache-Control": "public, max-age=3600",
    },
  });
};

export const config = { path: "/api/info-call.ics" };
