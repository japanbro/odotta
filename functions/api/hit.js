// POST /api/hit?k=イベント名 -> { count: 新カウント }
export async function onRequestPost({ env, request }) {
  const k = new URL(request.url).searchParams.get("k");
  if (!k) return json({ error: "missing k" }, 400);
  if (!env.LIKES) return json({ error: "KV not bound" }, 500);
  const raw = await env.LIKES.get("counts");
  const obj = raw ? JSON.parse(raw) : {};
  obj[k] = (obj[k] || 0) + 1;
  await env.LIKES.put("counts", JSON.stringify(obj));
  return json({ count: obj[k] });
}
function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
