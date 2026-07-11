// POST /api/hit?k=<eid>&op=inc|dec&id=<cid> -> { count: 新カウント }
// D1でアトミックに加減算。クライアント(cid)単位で冪等: 二重いいね/未いいねの取り消しは無視。
// ※ 本番は worker.js (wrangler deploy) が /api/* を処理する。こちらは Pages Functions 用の同等実装。
const ALLOWED_ORIGINS = ["https://odottar.com", "https://www.odottar.com"];
const EID_MAX = 32;
const ID_MAX = 64;
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()"
};

export async function onRequestPost({ env, request }) {
  const url = new URL(request.url);

  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden origin" }, 403);

  const eid = url.searchParams.get("k") || "";
  const cid = url.searchParams.get("id") || "";
  if (!eid || eid.length > EID_MAX) return json({ error: "bad k" }, 400);
  if (!cid || cid.length > ID_MAX) return json({ error: "bad id" }, 400);
  if (!env.DB) return json({ error: "D1 not bound" }, 500);

  const op = url.searchParams.get("op") === "dec" ? "dec" : "inc";

  const write = op === "inc"
    ? env.DB.prepare("INSERT OR IGNORE INTO likes (eid, cid) VALUES (?1, ?2)").bind(eid, cid)
    : env.DB.prepare("DELETE FROM likes WHERE eid = ?1 AND cid = ?2").bind(eid, cid);

  const read = env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM likes WHERE eid = ?1)
          + COALESCE((SELECT n FROM seed WHERE eid = ?1), 0) AS c`
  ).bind(eid);

  const [, res] = await env.DB.batch([write, read]);
  return json({ count: Number(res.results?.[0]?.c ?? 0) });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
