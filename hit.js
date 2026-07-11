// POST /api/hit?k=<eid>&op=inc|dec&id=<cid> -> { count: 新カウント }
// D1でアトミックに加減算。クライアント(cid)単位で冪等: 二重いいね/未いいねの取り消しは無視。
// ロジックは lib/likes.js に集約 (worker.js と共通)。
import { postHit } from "../../lib/likes.js";

export async function onRequestPost({ env, request }) {
  return postHit(env, request);
}
