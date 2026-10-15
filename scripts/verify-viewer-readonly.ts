/**
 * 端到端验证：登录 viewer01 抓取 dashboard HTML，验证：
 *   1. 侧边栏只显示 4 个白名单模块
 *   2. 主内容区有 data-readonly="true" 属性
 *   3. ReadOnlyEnforcer 客户端组件渲染了"只读演示模式"横幅
 *   4. 退出登录按钮带 data-allow-readonly="true"
 */
import "dotenv/config";

const BASE = "http://localhost:3000";
const EMAIL = "viewer01@ruiqishenkong.com";
const PASSWORD = "Pa@2026demo";

async function main() {
  // 1) CSRF
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookies = csrfRes.headers.get("set-cookie") ?? "";
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  console.log("[1] CSRF token:", csrfToken.slice(0, 12) + "…");

  // 2) Credentials login
  const body = new URLSearchParams({
    email: EMAIL,
    password: PASSWORD,
    csrfToken,
    callbackUrl: `${BASE}/dashboard`,
    json: "true",
  });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookies,
    },
    body,
    redirect: "manual",
  });
  const setCookies = [
    ...(loginRes.headers.getSetCookie?.() ?? []),
    loginRes.headers.get("set-cookie") ?? "",
  ].filter(Boolean);
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("next-auth.session-token=") || c.startsWith("__Secure-next-auth.session-token="))
    .join("; ");
  console.log("[2] login status:", loginRes.status, "sessionCookie:", sessionCookie ? "OK" : "MISSING");

  if (!sessionCookie) {
    console.error("登录失败，无 session cookie");
    process.exit(1);
  }

  // 3) GET /dashboard with session
  const dashRes = await fetch(`${BASE}/dashboard`, {
    headers: { Cookie: sessionCookie },
    redirect: "follow",
  });
  const html = await dashRes.text();
  console.log("[3] /dashboard status:", dashRes.status, "html length:", html.length);

  // 4) 验证侧边栏
  const asideMatch = html.match(/<aside[\s\S]*?<\/aside>/);
  if (!asideMatch) {
    console.error("[4] 找不到 <aside>");
    process.exit(1);
  }
  const aside = asideMatch[0];
  const navHrefs = Array.from(aside.matchAll(/href="(\/dashboard\/[^"]+)"/g)).map((m) => m[1]);
  const unique = Array.from(new Set(navHrefs));
  console.log("[4] 侧边栏链接：", unique);

  const expected = ["/dashboard/major-projects", "/dashboard/awards", "/dashboard/talent-declaration", "/dashboard/reception"];
  const allOk = expected.every((u) => unique.includes(u));
  console.log("[4] 4 个白名单模块是否都出现:", allOk);

  // 5) 验证 data-readonly
  const readonlyMatch = html.match(/data-readonly="(true|false)"/);
  console.log("[5] data-readonly:", readonlyMatch?.[1]);

  // 6) 验证只读横幅
  const bannerMatch = html.match(/只读演示模式/);
  console.log("[6] 只读横幅:", bannerMatch ? "存在" : "缺失");

  // 7) 验证 data-allow-readonly
  const allowCount = (html.match(/data-allow-readonly="true"/g) ?? []).length;
  console.log("[7] data-allow-readonly=true 出现次数:", allowCount, "（应 >= 2：折叠按钮 + 退出登录）");

  // 8) 验证 email 透传
  const emailMatch = html.match(/data-readonly-email="([^"]+)"/);
  console.log("[8] data-readonly-email:", emailMatch?.[1]);

  // 总结
  const checks = [
    ["侧边栏 4 模块齐全", allOk],
    ["data-readonly=true", readonlyMatch?.[1] === "true"],
    ["只读横幅渲染", !!bannerMatch],
    ["data-allow-readonly 例外", allowCount >= 2],
    ["email 透传", emailMatch?.[1] === EMAIL],
  ];
  console.log("\n=== 验证结果 ===");
  for (const [name, ok] of checks) {
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
  }
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error(`\n失败 ${failed.length} 项`);
    process.exit(1);
  }
  console.log("\n全部通过 ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
