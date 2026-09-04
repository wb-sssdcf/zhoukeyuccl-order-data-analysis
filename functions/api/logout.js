// ===== 退出登录接口：functions/api/logout.js =====
// 作用：把手环作废，退出登录
// 前端请求时在请求头加: Authorization: Bearer <token>

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) {
    await kv.delete("session:" + token); // 剪断手环
  }
  return json({ ok: true });
}
