// Unsubscribe link in the nurture emails (lib/nurture.mjs), proxied from pinkteamfiber.com/unsubscribe.
//   GET  shows a confirm button. Email scanners open links, so a GET alone never unsubscribes anyone.
//   POST unsubscribes: the confirm button, or a mail app's one-click unsubscribe (List-Unsubscribe-Post).
import { stopNurture } from "../../lib/nurture.mjs";

const page = (title, body, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Pink Team Fiber</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08050a;color:#f4ecf0;font:16px/1.6 Arial,Helvetica,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:420px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 20px;color:#c9b6c0}
button{background:#d6006e;color:#fff;border:0;border-radius:8px;padding:14px 28px;font:bold 16px Arial,Helvetica,sans-serif;cursor:pointer}
a{color:#ff5aa8}</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return page("Link not recognized", "<h1>Link not recognized</h1><p>Reply to any of our emails and we'll take you off the list.</p>", 400);
  }

  if (req.method === "POST") {
    try {
      await stopNurture(id, "Unsubscribed");
    } catch (err) {
      console.error("unsubscribe failed", id, err);
      return page("Something went wrong", "<h1>Something went wrong</h1><p>Reply to any of our emails and we'll take you off the list.</p>", 500);
    }
    return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>You won't get any more info call emails from Pink Team Fiber.</p><p><a href="https://pinkteamfiber.com/">pinkteamfiber.com</a></p>`);
  }

  return page(
    "Unsubscribe",
    `<h1>Stop the info call emails?</h1><p>You won't get any more emails about the Pink Team info call.</p><form method="post"><button type="submit">Unsubscribe</button></form>`,
  );
};

export const config = { path: "/api/unsubscribe" };
