// ===== 数据接口：functions/api/data.js =====
// 作用：GET /api/data 读取云端数据；PUT /api/data 保存云端数据。都必须带 token
// 同步策略：云端只存一份整份快照(gacha_data)，PUT 覆盖写。
// 冲突检测：客户端保存时带 baseUpdatedAt（它上次看到云端的版本），
//   若云端已被他人更新且客户端基准不一致 -> 返回 409，客户端确认后可强制覆盖(force)。
// 每次保存把操作日志写入 gacha_log（保留最近 200 条）。

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// 从请求头里掏出登录凭证，去 KV 验证是否有效、是否过期
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

function nowText() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

// 追加操作日志（读-改-写，最多保留 200 条；日志失败不影响主流程）
async function appendLog(kv, entry) {
  try {
    const raw = await kv.get("gacha_log");
    let arr = [];
    if (raw) {
      try { arr = JSON.parse(raw); } catch (e) { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    arr.push({
      t: nowText(),
      user: entry.user,
      action: entry.action || "保存",
      size: entry.size || 0,
    });
    if (arr.length > 200) arr = arr.slice(-200);
    await kv.put("gacha_log", JSON.stringify(arr));
  } catch (e) { /* ignore */ }
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

// PUT /api/data → 把网页传来的数据存进云端（带冲突检测）
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
  const payload = body && body.data;
  if (!payload || typeof payload !== "object") return json({ error: "数据格式不对" }, 400);

  // 读取云端当前值，用于冲突检测
  let cur = null;
  const raw = await kv.get("gacha_data");
  if (raw) {
    try { cur = JSON.parse(raw); } catch (e) { cur = null; }
  }
  const curAt = (cur && cur.updatedAt) || null;
  const base = body.baseUpdatedAt || null;

  // 冲突检测：云端已有数据、客户端给了基准版本、且基准与云端不一致
  // -> 说明自客户端上次看到云端以来被其他人保存过，直接覆盖可能吞掉对方新数据
  if (!body.force && curAt && base && base !== curAt) {
    return json({
      error: "云端数据已被他人更新，请确认后再覆盖",
      cloudUpdatedAt: curAt,
      cloudUpdatedBy: (cur && cur.updatedBy) || "未知",
    }, 409);
  }

  await kv.put("gacha_data", JSON.stringify(payload));
  await appendLog(kv, {
    user: user,
    action: body.force ? "保存（强制覆盖）" : "保存",
    size: JSON.stringify(payload).length,
  });
  return json({ ok: true, savedBy: user, savedAt: nowText() });
}
