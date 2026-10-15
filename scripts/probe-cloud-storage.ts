// 探测云端部署的 /api/reception/upload-photo 是否已识别 Supabase 环境变量。
// 凭据从 .env.probe 读取（不入 git）。只请求签名上传 URL，不上传实际文件。

async function main() {
  const BASE = process.env.PROBE_BASE!;
  const EMAIL = process.env.PROBE_EMAIL!;
  const PASSWORD = process.env.PROBE_PASSWORD!;

  // 1. 拿 CSRF
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const allCookies = (csrfRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  console.log("csrf ok:", !!csrfToken);

  // 2. 登录
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: allCookies.join("; "),
    },
    body: new URLSearchParams({
      email: EMAIL,
      password: PASSWORD,
      csrfToken,
      callbackUrl: `${BASE}/dashboard`,
      json: "true",
    }),
    redirect: "manual",
  });
  const loginCookies = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const fullCookies = [...new Set([...allCookies, ...loginCookies])].join("; ");
  console.log("login status:", loginRes.status);

  // 3. 验证会话
  const sessionRes = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: fullCookies } });
  const session = (await sessionRes.json()) as { user?: { email?: string; role?: string } };
  console.log("session user:", session.user?.email, "/", session.user?.role);
  if (!session.user) {
    console.error("登录失败，无法继续探测");
    process.exit(1);
  }

  // 4. 调用上传接口（只拿签名 URL）
  const uploadRes = await fetch(`${BASE}/api/reception/upload-photo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: fullCookies },
    body: JSON.stringify({
      filename: "probe.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
    }),
  });
  const status = uploadRes.status;
  let body: string;
  try {
    body = JSON.stringify(await uploadRes.json());
  } catch {
    body = await uploadRes.text();
  }
  console.log("\n=== PROBE RESULT ===");
  console.log("HTTP", status);
  console.log(body);

  if (status === 200) {
    console.log("\n[OK] storage env vars are live, upload chain works");
  } else if (body.includes("storage not configured") || status === 500) {
    console.log("\n[BAD] storage env vars NOT live on the deployment");
  } else {
    console.log("\n[WARN] unexpected response, see above");
  }
}

main().catch((e) => {
  console.error("probe error:", e);
  process.exit(1);
});
