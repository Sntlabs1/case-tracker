// Access gate for the live platform.
//
// Background: a shareable pitch HTML went out with a link to this deployment
// (mdl-business.vercel.app). This middleware keeps the site private without a
// paid Vercel plan: anyone who opens the URL without the key sees a "private"
// wall; the team enters once via  https://mdl-business.vercel.app/?key=<KEY>
// which sets a one-year cookie and lets them straight in from then on.
//
// /api/* and Vercel internals are intentionally NOT gated so the ~20 cron jobs
// keep running and the authenticated SPA can still fetch its data. To rotate
// access, change KEY below and redeploy (existing cookies stop working).

const KEY = "4c3cc90acd2d5e85f496a82e";
const COOKIE = "mdl_access";

const BLOCK_PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#181611;
    font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#e9e2d2}
  .card{max-width:420px;text-align:center;padding:40px 32px}
  h1{font-size:20px;margin:0 0 10px;font-weight:700;letter-spacing:.02em}
  p{font-size:14px;line-height:1.6;color:#b3ab99;margin:0}
  .dot{width:34px;height:34px;border-radius:50%;border:1px solid #3a352a;
    display:inline-flex;align-items:center;justify-content:center;margin-bottom:18px;font-size:16px}
</style></head><body>
<div class="card"><div class="dot">&#128274;</div>
<h1>This page is private</h1>
<p>You need an access link to view this site. If you believe you should have access, contact the owner.</p>
</div></body></html>`;

export default function middleware(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Never gate the API (cron jobs + authenticated SPA data) or Vercel internals.
  if (path.startsWith("/api/") || path.startsWith("/_vercel")) return;

  // Already authorized via cookie.
  const cookie = req.headers.get("cookie") || "";
  if (cookie.split(";").some((c) => c.trim() === COOKIE + "=" + KEY)) return;

  // Entering with the key: set the cookie and redirect to a clean URL.
  if (url.searchParams.get("key") === KEY) {
    url.searchParams.delete("key");
    return new Response(null, {
      status: 302,
      headers: {
        Location: path + (url.search || ""),
        "Set-Cookie": `${COOKIE}=${KEY}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`,
      },
    });
  }

  // Otherwise, block.
  return new Response(BLOCK_PAGE, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
