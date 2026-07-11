// odottar API + 静的アセット配信
// GET  /api/counts                          … いいね数マップ { eid: 数 }
// POST /api/hit?k=<eid>&op=inc|dec&id=<cid> … クライアント単位で冪等に加減算 (D1・アトミック)
//
// カウンタの実体は lib/likes.js (functions/api/* と共通)。
// セキュリティ方針:
// - id(クライアント識別子)必須。無しの無限inc穴を塞ぐ。
// - k(eid)/id は長さ上限。
// - Origin許可リストで他サイト/素のcurlを弾く(速度制限の代替ではない)。
// - 全レスポンスに基本セキュリティヘッダを付与。
// ※ 連打・水増し対策は Cloudflare Dashboard の Rate Limiting / Turnstile 併用が前提。

import { getCounts, postHit, SECURITY_HEADERS } from "./lib/likes.js";

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
