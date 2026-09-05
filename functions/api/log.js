// ===== 操作日志接口：functions/api/log.js =====
// 作用：
//   GET    /api/log          —— 返回最近云端操作日志（需登录 token）
//   DELETE /api/log?id=0     —— 删除单条日志（仅 super，按数组下标，0 为最早一条）
//   DELETE /api/log?all=1    —— 清空全部日志（仅 super；清空后会保留一条审计记录）
// 云端最多保留 200 条日志。

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
  if (session.expiresAt < Date.now()) return null;
  return session.username;
}

// 查询账号角色（与 login.js / account.js / data.js 同一套规则）
async function getRole(kv, username) {
  try {
    const recStr = await kv.get("admin:" + username);
    if (recStr) {
      const rec = JSON.parse(recStr);
      return rec.role || (username === "ad001" ? "super" : "admin");
    }
  } catch (e) { /* ignore */ }
  return username === "ad001" ? "super" : "admin";
}

async function readLogs(kv) {
  const raw = await kv.get("gacha_log");
  let logs = [];
  if (raw) {
    try { logs = JSON.parse(raw); } catch (e) { logs = []; }
  }
  if (!Array.isArray(logs)) logs = [];
  return logs;
}

function nowText() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

// 追加日志（数组先进先删，超过 200 条裁掉最旧）
async function appendLog(kv, logs, entry) {
  logs.push({ t: nowText(), user: entry.user, action: entry.action || "保存", size: entry.size || 0 });
  if (logs.length > 200) logs = logs.slice(-200);
  await kv.put("gacha_log", JSON.stringify(logs));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  const user = await getUser(request, kv);
  if (!user) return json({ error: "没有登录或登录已过期，请重新登录" }, 401);

  const logs = await readLogs(kv);
  return json({ logs: logs });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  // 1. 必须已登录
  const operator = await getUser(request, kv);
  if (!operator) return json({ error: "没有登录或登录已过期，请重新登录" }, 401);

  // 2. 仅超级管理员可删除/清空日志
  const opRole = await getRole(kv, operator);
  if (opRole !== "super") return json({ error: "仅超级管理员可删除日志" }, 403);

  const logs = await readLogs(kv);
  const url = new URL(request.url);
  const qAll = url.searchParams.get("all");
  const qId = url.searchParams.get("id");

  // ---- 清空全部：先把“清空”这一动作本身留下审计记录 ----
  if (qAll !== null) {
    const count = logs.length;
    await appendLog(kv, [], { user: operator, action: "清空全部云端日志（原 " + count + " 条）" });
    const after = await readLogs(kv);
    return json({ ok: true, cleared: count, logs: after });
  }

  // ---- 删除单条：先记审计，再按原始下标删除 ----
  const idx = parseInt(qId, 10);
  if (isNaN(idx) || idx < 0 || idx >= logs.length) {
    return json({ error: "日志下标不合法" }, 400);
  }
  const target = logs[idx] || {};
  await appendLog(kv, logs, {
    user: operator,
    action: "删除日志记录（" + (target.user || "-") + " " + (target.action || "-") + "）",
  });
  // 追加发生在末尾，原目标下标不受影响（若触发 200 条裁尾导致目标被裁掉，视为已删除）
  const before = logs;
  if (idx < before.length) before.splice(idx, 1);
  await kv.put("gacha_log", JSON.stringify(before));
  return json({ ok: true, deleted: idx, logs: before });
}
