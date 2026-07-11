// odottar API + 静的アセット配信
// GET  /api/counts                       … いいね数マップ { 名前: 数 }
// POST /api/hit?k=名前&op=inc|dec&id=CID  … クライアント単位で冪等に加減算
//
// セキュリティ方針:
// - id(クライアント識別子)必須。無しの無限inc穴を塞ぐ。
// - k/id は長さ上限。counts のキー数も上限で肥大化/KV濫用を抑止。
// - Origin許可リストで他サイト/素のcurlを弾く(速度制限の代替ではない)。
// - 全レスポンスに基本セキュリティヘッダを付与。
// ※ 本質的な連打対策は Cloudflare Dashboard の Rate Limiting / Turnstile 併用が前提。

const ALLOWED_ORIGINS = ["https://odottar.com", "https://www.odottar.com"];
const K_MAX = 120;    // イベント名の最大長
const ID_MAX = 64;    // クライアントID(UUID想定)の最大長
const MAX_KEYS = 5000; // counts に載せられる最大イベント数

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/counts") {
      const data = (env.LIKES && await env.LIKES.get("counts")) || "{}";
      return json(data, 200);
    }

    if (url.pathname === "/api/hit" && request.method === "POST") {
      // Origin検査(ブラウザからの正規POSTは Origin を送る)
      const origin = request.headers.get("Origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return json(JSON.stringify({ error: "forbidden origin" }), 403);
      }

      const k = url.searchParams.get("k");
      const id = url.searchParams.get("id") || "";
      if (!k || k.length > K_MAX) return json(JSON.stringify({ error: "bad k" }), 400);
      if (!id || id.length > ID_MAX) return json(JSON.stringify({ error: "bad id" }), 400);
      if (!env.LIKES) return json(JSON.stringify({ error: "KV not bound" }), 500);

      const op = url.searchParams.get("op") === "dec" ? "dec" : "inc";

      const counts = JSON.parse((await env.LIKES.get("counts")) || "{}");
      const likedKey = "l:" + id;
      const liked = JSON.parse((await env.LIKES.get(likedKey)) || "{}");

      // 未知イベントの新規追加はキー数上限で制限(既存キーは常に可)
      if (!(k in counts) && Object.keys(counts).length >= MAX_KEYS) {
        return json(JSON.stringify({ error: "capacity" }), 429);
      }

      let changed = true;
      if (op === "dec") {
        if (liked[k]) {
          counts[k] = Math.max(0, (counts[k] || 0) - 1);
          delete liked[k];
        } else { changed = false; } // 未いいねの取り消しは無視
      } else {
        if (!liked[k]) {
          counts[k] = (counts[k] || 0) + 1;
          liked[k] = 1;
        } else { changed = false; } // 二重いいねは無視
      }

      if (changed) {
        await env.LIKES.put("counts", JSON.stringify(counts));
        await env.LIKES.put(likedKey, JSON.stringify(liked));
      }
      return json(JSON.stringify({ count: counts[k] || 0 }), 200);
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

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()"
};

function json(body, status) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
