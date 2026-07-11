// odottar API + 静的アセット配信
// GET  /api/counts                          … いいね数マップ { eid: 数 }
// POST /api/hit?k=<eid>&op=inc|dec&id=<cid> … クライアント単位で冪等に加減算 (D1・アトミック)
//
// ■ いいねカウンタを KV → D1 に移行した理由 (2026-07-11)
//  旧実装は KV の単一キー "counts" に全イベントのカウントをJSONで入れ、read → +1 → write していた。
//   - KVはアトミックでない → 同時いいねで lost update
//   - KVは結果整合で get が最大60秒古い値を返す → その古い値を書き戻し、直近1分のいいねが巻き戻る
//   - 全イベントが同じキーを共有するので、別イベント同士でも競合する
//   - 同一キーへの書き込みは 1回/秒 上限
//  → 「他人のいいねが出ない/増えない」の原因。
//  新実装は D1 で 1いいね = likes(eid,cid) の1行。INSERT OR IGNORE / DELETE はアトミックで、
//  PRIMARY KEY(eid,cid) が二重いいねをDBレベルで拒否する。
//  キーもイベント名 → 不変ID eid に変更 (改名でカウント消失/同名別日イベントの合算を防ぐ)。
//
// ■ セキュリティ方針
//  - id(クライアント識別子)必須。無しの無限inc穴を塞ぐ。
//  - k(eid)/id は長さ上限。
//  - Origin許可リストで他サイト/素のcurlを弾く(速度制限の代替ではない)。
//  - 全レスポンスに基本セキュリティヘッダを付与。
//  ※ 連打・水増し対策は Cloudflare Dashboard の Rate Limiting / Turnstile 併用が前提。

const ALLOWED_ORIGINS = ["https://odottar.com", "https://www.odottar.com"];
const EID_MAX = 32;
const ID_MAX = 64;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()"
};

function json(obj, status = 200) {
  return new Response(typeof obj === "string" ? obj : JSON.stringify(obj), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

// GET /api/counts -> { eid: いいね数, ... }
async function getCounts(env) {
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
async function postHit(env, request) {
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
  return json({ count: Number(res.results?.[0]?.c ?? 0) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/counts" && request.method === "GET") {
      return getCounts(env);
    }

    if (url.pathname === "/api/hit" && request.method === "POST") {
      return postHit(env, request);
    }

    if (url.pathname === "/sitemap.xml") {
      const today = new Date().toISOString().slice(0, 10);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://odottar.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
      return new Response(xml, {
        headers: { ...SECURITY_HEADERS, "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" }
      });
    }

    // 静的アセットにもセキュリティヘッダを付与
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [h, v] of Object.entries(SECURITY_HEADERS)) headers.set(h, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};
