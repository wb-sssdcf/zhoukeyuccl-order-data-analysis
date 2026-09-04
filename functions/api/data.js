// ===== 数据接口：functions/api/data.js =====
// 作用：GET /api/data 读取云端数据；PUT /api/data 保存云端数据。都必须带手环(token)
// 前端请求时在请求头加: Authorization: Bearer <token>

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// 从请求头里掏出手环，去 KV 验证是否有效、是否过期
async function getUser(request, kv) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const str = await kv.get("session:" + token);
  if (!str) return null;
  const session = JSON.parse(str);
  if (session.expiresAt < Date.now()) return null; // 过期了
  return session.username;
}

// GET /api/data → 返回云端数据
export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  const user = await getUser(request, kv);
  if (!user) return json({ error: "没有登录或登录已过期，请重新登录" }, 401);

  const raw = await kv.get("gacha_data");
  return json({ data: raw ? JSON.parse(raw) : null });
}

// PUT /api/data → 把网页传来的数据存进云端（覆盖式保存，后保存覆盖先保存）
export async function onRequestPut(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  const user = await getUser(request, kv);
  if (!user) return json({ error: "没有登录或登录已过期，请重新登录" }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "请求格式不对" }, 400);
  }

  // data 就是网页传来的整个数据对象（可以是一整个工作簿 JSON）
  await kv.put("gacha_data", JSON.stringify(body.data));
  return json({ ok: true, savedBy: user });
}
