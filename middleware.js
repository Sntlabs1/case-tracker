// Access gate for the live platform.
//
// Vercel Authentication / Password Protection for the *production* domain is a
// paid feature, unavailable on this plan, so this middleware is the access
// gate. It now covers BOTH pages and the API:
//   - Pages: no key → a "private" wall. Enter once via
//     https://mdl-business.vercel.app/?key=<ACCESS_KEY> to set a one-year cookie.
//   - /api/*: allowed only for (a) the authenticated SPA, whose same-origin
//     fetches carry the access cookie, or (b) Vercel cron jobs, which Vercel
//     invokes with `Authorization: Bearer <CRON_SECRET>`. Everyone else: 401.
//   - /_vercel internals are never gated.
//
// Secrets live in env vars (not git): ACCESS_KEY (rotate to revoke all access)
// and CRON_SECRET (must match the Vercel project env so cron jobs pass). The
// hardcoded ACCESS_KEY fallback is the OLD already-public key, kept only so a
// missing env var degrades to "old key" rather than locking everyone out.

const KEY = process.env.ACCESS_KEY || "4c3cc90acd2d5e85f496a82e";
const CRON_SECRET = process.env.CRON_SECRET || "";
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

  // Vercel internals always pass.
  if (path.startsWith("/_vercel")) return;

  const cookie = req.headers.get("cookie") || "";
  const hasAccess = cookie.split(";").some((c) => c.trim() === COOKIE + "=" + KEY);

  // API: the authenticated SPA passes via its cookie; Vercel cron jobs pass via
  // the Bearer secret. Anything else is rejected with a JSON 401.
  if (path.startsWith("/api/")) {
    if (hasAccess) return;
    const auth = req.headers.get("authorization") || "";
    if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return;
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Pages — already authorized via cookie.
  if (hasAccess) return;

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
