/**
 * GET /api/feishu/debug  （仅 SUPER_ADMIN 可访问）
 *
 * 诊断飞书 token 是否有效、通讯录权限范围是否正确。
 * 访问路径：https://pa-platform-kappa.vercel.app/api/feishu/debug
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTenantAccessToken } from "@/lib/feishu";

export async function GET() {
  const session = await getSession();
  if (!session?.user || session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可访问" }, { status: 403 });

  const diag: Record<string, unknown> = {
    app_id_prefix:     process.env.FEISHU_APP_ID?.slice(0, 8)  ?? "NOT_SET",
    app_id_length:     process.env.FEISHU_APP_ID?.length       ?? 0,
    app_secret_length: process.env.FEISHU_APP_SECRET?.length   ?? 0,
  };

  // ── Step 1: 获取 tenant_access_token ──────────────────────────
  let token: string;
  try {
    token = await getTenantAccessToken();
    diag.tenant_token_prefix = token.slice(0, 10) + "…";
    diag.tenant_token_length = token.length;
  } catch (err) {
    diag.tenant_token_error = (err as Error).message;
    return NextResponse.json(diag);
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // ── Step 2: 检查通讯录可见范围（contact/v3/scopes）────────────
  try {
    const r = await fetch("https://open.feishu.cn/open-apis/contact/v3/scopes", {
      headers,
      cache: "no-store",
    });
    const j = await r.json();
    diag.scopes = {
      code:           j.code,
      msg:            j.msg,
      department_ids: j.data?.department_ids ?? [],
      user_ids:       j.data?.user_ids       ?? [],
      has_all_access: !!(j.data?.department_ids?.length || j.data?.user_ids?.length),
    };
  } catch (err) {
    diag.scopes_error = (err as Error).message;
  }

  // ── Step 3: 测试 contact 搜索接口 ─────────────────────────────
  try {
    const r = await fetch(
      "https://open.feishu.cn/open-apis/contact/v3/users/search?user_id_type=open_id",
      {
        method: "POST",
        headers,
        cache: "no-store",
        body:   JSON.stringify({ query: "a", page_size: 1 }),
      }
    );
    const j = await r.json();
    diag.contact_search = { code: j.code, msg: j.msg, items: j.data?.items?.length ?? 0 };
  } catch (err) {
    diag.contact_search_error = (err as Error).message;
  }

  // ── Step 4: 测试 search/v1/user 接口 ──────────────────────────
  try {
    const r = await fetch(
      "https://open.feishu.cn/open-apis/search/v1/user?query=a&page_size=1",
      { headers, cache: "no-store" }
    );
    const j = await r.json();
    diag.search_v1 = { code: j.code, msg: j.msg, results: j.data?.results?.length ?? 0 };
  } catch (err) {
    diag.search_v1_error = (err as Error).message;
  }

  // ── Step 5: 诊断 Bitable —— wiki 节点解析 + 表信息 ─────────────
  const appToken  = process.env.FEISHU_BITABLE_APP_TOKEN  ?? "";
  const tableId   = process.env.FEISHU_RECEPTION_TABLE_ID ?? "";
  diag.bitable_cfg = { app_token_prefix: appToken.slice(0, 8), table_id: tableId };

  if (appToken) {
    // 5a: 尝试用 wiki 节点 API 解析真实 obj_token
    try {
      const wr = await fetch(
        `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${appToken}`,
        { headers, cache: "no-store" }
      );
      const wj = await wr.json();
      diag.wiki_node = {
        code:      wj.code,
        msg:       wj.msg,
        obj_type:  wj.data?.node?.obj_type,
        obj_token: wj.data?.node?.obj_token,
      };
      // 如果是 wiki 节点，obj_token 才是真正的 bitable app_token
      const realToken = wj.code === 0 ? (wj.data?.node?.obj_token ?? appToken) : appToken;
      diag.bitable_real_app_token = realToken;

      // 5b: 列出表中所有字段（验证列名）
      if (tableId) {
        const fr = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${realToken}/tables/${tableId}/fields`,
          { headers, cache: "no-store" }
        );
        const fj = await fr.json() as { code: number; msg: string; data?: { items?: Array<{ field_name: string; type: number }> } };
        diag.bitable_fields = {
          code:   fj.code,
          msg:    fj.msg,
          fields: fj.data?.items?.map(f => ({ name: f.field_name, type: f.type })) ?? [],
        };
      }

      // 5c: 测试写入一条真实格式的记录（写完立即删除）
      if (tableId) {
        const testFields: Record<string, unknown> = {
          "会议名称/来访人员": "【系统诊断测试，请忽略】",
          "日期":             Date.now(),
        };
        const cr = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${realToken}/tables/${tableId}/records`,
          {
            method:  "POST",
            headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
            body:    JSON.stringify({ fields: testFields }),
            cache:   "no-store",
          }
        );
        const cj = await cr.json() as { code: number; msg: string; data?: { record?: { record_id?: string } } };
        diag.bitable_create_test = { code: cj.code, msg: cj.msg, record_id: cj.data?.record?.record_id };
        if (cj.code === 0 && cj.data?.record?.record_id) {
          await fetch(
            `https://open.feishu.cn/open-apis/bitable/v1/apps/${realToken}/tables/${tableId}/records/${cj.data.record.record_id}`,
            { method: "DELETE", headers, cache: "no-store" }
          );
          diag.bitable_create_test_cleanup = "deleted";
        }
      }
    } catch (err) {
      diag.bitable_error = (err as Error).message;
    }
  }

  return NextResponse.json(diag, { status: 200 });
}
