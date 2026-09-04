// ===== 操作日志接口：functions/api/log.js =====
// 作用：GET /api/log 返回最近云端操作日志（需登录 token），用于追溯"谁在何时保存了什么"

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getUser(request, kv) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const str = await kv.get("session:" + token);
  if (!str) return null;
  const session = JSON.parse(str);
  if (session.expiresAt < Date.now()) return null;
  return session.username;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  const user = await getUser(request, kv);
  if (!user) return json({ error: "没有登录或登录已过期，请重新登录" }, 401);

  const raw = await kv.get("gacha_log");
  let logs = [];
  if (raw) {
    try { logs = JSON.parse(raw); } catch (e) { logs = []; }
  }
  if (!Array.isArray(logs)) logs = [];
  return json({ logs: logs });
}
