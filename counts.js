// GET /api/counts -> { eid: いいね数, ... }
// ※ 本番は worker.js (wrangler deploy) が /api/* を処理する。こちらは Pages Functions 用の同等実装。
//   依存なしで完結させている (import 先を追加すると GitHub Web UI からのアップロード漏れでビルドが落ちるため)。
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()"
};

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "D1 not bound" }, 500);
  const { results } = await env.DB.prepare(
    `SELECT eid, SUM(n) AS c FROM (
       SELECT eid, COUNT(*) AS n FROM likes GROUP BY eid
       UNION ALL
       SELECT eid, n FROM seed
     ) GROUP BY eid HAVING c > 0`
  ).all();
  const out = {};
  for (const r of results) out[r.eid] = Number(r.c);
  return json(out);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
