// ===== 登录接口：functions/api/login.js =====
// 作用：接收账号密码，验证通过就发一张"手环"(token)
// 部署后访问地址: https://你的域名/api/login (POST)

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// 单向碎纸机：把文字变成哈希
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// 生成随机字符串（做盐、做 token 都用它）
function randomHex(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.GACHA_KV; // 必须与 Cloudflare 后台绑定名完全一致

  // 1. 读出网页传来的账号密码
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "请求格式不对" }, 400);
  }
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!username || !password) {
    return json({ error: "请输入账号和密码" }, 400);
  }

  // 2. 去 KV 仓库找这个账号（key 是 admin:用户名）
  const recordStr = await kv.get("admin:" + username);
  if (!recordStr) {
    return json({ error: "账号或密码不对" }, 401);
  }
  const record = JSON.parse(recordStr);

  // 3. 把输入的密码 + 账号自己的盐一起碎纸，与存的哈希对比
  const hash = await sha256(record.salt + password);
  if (hash !== record.passwordHash) {
    return json({ error: "账号或密码不对" }, 401);
  }

  // 4. 验证通过：发手环，存进 KV，7 天自动过期
  const token = randomHex(32);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await kv.put(
    "session:" + token,
    JSON.stringify({ username, expiresAt }),
    { expirationTtl: 7 * 24 * 60 * 60 }
  );

  return json({ token, username });
}
