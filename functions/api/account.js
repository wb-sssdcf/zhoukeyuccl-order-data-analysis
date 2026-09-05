// ===== 账号创建接口：functions/api/account.js =====
// 作用：仅超级管理员(super)可调用，用于新建管理员/超管账号
// 调用：POST /api/account
//   body: { username: "新账号名", password: "密码", role?: "admin" | "super" }
//   需带请求头 Authorization: Bearer <超管的 token>
// 账号记录写入 KV key: admin:<用户名>（与 login.js 读取一致）

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

// 查询账号角色（与 login.js / data.js 同一套规则：显式 role 优先，未写时 ad001 为 super）
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

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

function nowText() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV;

  // 1. 必须已登录
  const operator = await getUser(request, kv);
  if (!operator) return json({ error: "没有登录或登录已过期，请重新登录" }, 401);

  // 2. 必须是超管
  const opRole = await getRole(kv, operator);
  if (opRole !== "super") return json({ error: "仅超级管理员可创建账号" }, 403);

  // 3. 读取参数
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "请求格式不对" }, 400);
  }
  const action = String(body.action || "create").trim().toLowerCase();

  // ---- 改名：把 username 账号改名为 newUsername（保留密码/角色/创建信息） ----
  if (action === "rename") {
    const oldName = String(body.username || "").trim().toLowerCase();
    const newName = String(body.newUsername || "").trim().toLowerCase();
    if (!oldName || !newName) return json({ error: "请填写原账号名和新账号名" }, 400);
    if (newName.length > 20) return json({ error: "新账号名不能超过 20 个字符" }, 400);
    if (newName === oldName) return json({ error: "新旧账号名相同，无需改名" }, 400);
    if (newName === "ad001") return json({ error: "ad001 为内置超管，不可改名覆盖" }, 400);

    const oldStr = await kv.get("admin:" + oldName);
    if (!oldStr) return json({ error: "原账号不存在：" + oldName }, 404);
    const dup = await kv.get("admin:" + newName);
    if (dup) return json({ error: "新账号名已被占用：" + newName }, 409);

    let rec;
    try { rec = JSON.parse(oldStr); } catch (e) { return json({ error: "原账号记录损坏" }, 500); }
    rec.username = newName;
    rec.renamedAt = nowText();
    rec.renamedBy = operator;
    rec.renamedFrom = oldName;
    await kv.put("admin:" + newName, JSON.stringify(rec));
    await kv.delete("admin:" + oldName);
    await appendLog(kv, { user: operator, action: "改名:" + oldName + "→" + newName, size: 0 });
    return json({ ok: true, username: newName, role: rec.role || "admin" });
  }

  // ---- 默认：创建账号 ----
  let username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  let role = String(body.role || "admin").trim().toLowerCase();

  if (!username) return json({ error: "请填写新账号名" }, 400);
  if (username.length > 20) return json({ error: "账号名不能超过 20 个字符" }, 400);
  if (password.length < 6) return json({ error: "密码至少 6 位" }, 400);
  if (role !== "super" && role !== "admin") role = "admin";

  // 4. 不能覆盖已有账号
  const existing = await kv.get("admin:" + username);
  if (existing) return json({ error: "该账号已存在，不能重复创建" }, 409);

  // 5. 写入账号记录
  const salt = randomHex(16);
  const passwordHash = await sha256(salt + password);
  const record = {
    username: username,
    salt: salt,
    passwordHash: passwordHash,
    role: role,
    createdAt: nowText(),
    createdBy: operator,
  };
  await kv.put("admin:" + username, JSON.stringify(record));
  await appendLog(kv, { user: operator, action: "建号:" + username + "(" + role + ")", size: 0 });

  return json({ ok: true, username: username, role: role });
}
