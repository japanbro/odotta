// いいねカウンタ共通ロジック (D1)
//
// 旧実装の問題:
//  - 全イベントのカウントをKVの単一キー "counts" に入れ、read → +1 → write していた。
//    KVはアトミックでなく結果整合(最大60秒古い値を返す)なので、
//    同時アクセスで lost update が発生し、カウントが落ちる/巻き戻る。
//    さらに同一キーへの書き込みは 1回/秒 上限で、人気が出るほど壊れる。
//  - キーがイベント名だったため、改名でカウント消失、同名別日イベント(例:都立東綾瀬公園×3)が合算されていた。
//
// 新実装:
//  - D1。1いいね = likes(eid, cid) の1行。PRIMARY KEY で二重いいねを拒否。
//    INSERT OR IGNORE / DELETE はアトミックなのでレースが原理的に起きない。
//  - キーは不変ID eid (name|start|venue のハッシュ、index.html の DATA に固定値で埋め込み済み)。
//  - 表示カウント = seed.n (旧KVからの引き継ぎ) + likes の行数。

export const ALLOWED_ORIGINS = ["https://odottar.com", "https://www.odottar.com"];
export const EID_MAX = 32;
export const ID_MAX = 64;

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()"
};

export function json(obj, status = 200) {
  return new Response(typeof obj === "string" ? obj : JSON.stringify(obj), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

// GET /api/counts -> { eid: いいね数, ... }
export async function getCounts(env) {
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

// POST /api/hit?k=<eid>&op=inc|dec&id=<cid> -> { count }
export async function postHit(env, request) {
  const url = new URL(request.url);

  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden origin" }, 403);

  const eid = url.searchParams.get("k") || "";
  const cid = url.searchParams.get("id") || "";
  if (!eid || eid.length > EID_MAX) return json({ error: "bad k" }, 400);
  if (!cid || cid.length > ID_MAX) return json({ error: "bad id" }, 400);
  if (!env.DB) return json({ error: "D1 not bound" }, 500);

  const op = url.searchParams.get("op") === "dec" ? "dec" : "inc";

  // batch はトランザクションで直列実行される。
  // inc: 既にいいね済みなら OR IGNORE で無視 (冪等)。dec: 無ければ0行削除 (冪等)。
  const write = op === "inc"
    ? env.DB.prepare("INSERT OR IGNORE INTO likes (eid, cid) VALUES (?1, ?2)").bind(eid, cid)
    : env.DB.prepare("DELETE FROM likes WHERE eid = ?1 AND cid = ?2").bind(eid, cid);

  const read = env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM likes WHERE eid = ?1)
          + COALESCE((SELECT n FROM seed WHERE eid = ?1), 0) AS c`
  ).bind(eid);

  const [, res] = await env.DB.batch([write, read]);
  const count = Number(res.results?.[0]?.c ?? 0);
  return json({ count });
}
