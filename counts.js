// GET /api/counts -> { eid: いいね数, ... }
import { getCounts } from "../../lib/likes.js";

export async function onRequestGet({ env }) {
  return getCounts(env);
}
