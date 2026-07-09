// GET /api/counts -> { "イベント名": いいね数, ... }
export async function onRequestGet({ env }) {
  const data = (env.LIKES && await env.LIKES.get("counts")) || "{}";
  return new Response(data, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
