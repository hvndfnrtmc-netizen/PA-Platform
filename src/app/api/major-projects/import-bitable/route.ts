/**
 * POST /api/major-projects/import-bitable
 * 从飞书多维表格同步记录到 major_projects 表
 * Body: { appToken: string, tableId: string, isWiki?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getAppAccessToken } from "@/lib/feishu";

// ── 飞书字段类型解析 ──────────────────────────────────────────
// 飞书 Bitable API 各字段类型对应的 payload 格式：
//
//   字段类型          | 返回格式示例
//   ─────────────────────────────────────────────────────────
//   单行/多行文本      | "普通字符串"  或  [{type:'text',text:'...'}]
//   数字              | 123.4
//   日期              | 1690000000000  (Unix 毫秒)
//   单选              | {text:'进行中', color:1}
//   多选              | [{text:'选项A',color:1},{text:'选项B',color:2}]
//   人员 (User)       | [{id:'ou_xxx', name:'Zoe Gu', en_name:'Zoe Gu'}]
//   富文本 (含@/链接) | [{type:'text',text:'...'},{type:'mention',...}]
//   复选框            | true / false

/**
 * 从任意飞书字段值中提取可读的纯文本字符串。
 *
 * 优先级（数组元素）：
 *   1. 纯字符串元素 → 直接使用
 *   2. 有 type + text → 富文本段落，取 text
 *   3. 有 name（无 type）→ 人员字段，取 name；多人用"、"连接
 *   4. 有 text（无 type）→ 单/多选，取 text；多选用"、"连接
 */
function extractFeishuText(v: unknown): string {
  if (v === null || v === undefined) return "";

  if (Array.isArray(v)) {
    if (v.length === 0) return "";

    const first = v[0] as Record<string, unknown>;

    // ── 人员字段：[{id, name, en_name}]
    //    判断依据：元素有 name 属性但没有 type 属性
    if (first && typeof first === "object" && "name" in first && !("type" in first)) {
      return v
        .map(seg => {
          const s = seg as Record<string, unknown>;
          return String(s.name ?? "").trim();
        })
        .filter(Boolean)
        .join("、");
    }

    // ── 多选字段：[{text, color}]  /  富文本：[{type, text}]
    return v
      .map((seg: unknown) => {
        if (typeof seg === "string") return seg;
        if (seg && typeof seg === "object") {
          const s = seg as Record<string, unknown>;
          // 富文本段落：优先取 text
          if ("text" in s) return String(s.text ?? "");
          // 人员（兜底，理论上已在上方处理）
          if ("name" in s) return String(s.name ?? "");
        }
        return "";
      })
      .join("")   // 富文本拼接，多选会在上方分支处理
      .trim();
  }

  // ── 单选对象：{text, color}
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if ("text" in obj) return String(obj.text ?? "").trim();
    if ("name" in obj) return String(obj.name ?? "").trim();
  }

  return String(v).trim();
}

function cleanText(v: unknown): string | null {
  const s = extractFeishuText(v);
  return s === "" || s === "/" ? null : s;
}
function cleanFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "number") return new Date(v); // 飞书返回 Unix 毫秒
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/** Wiki token → 真实 Bitable app_token */
async function resolveWikiToken(wikiToken: string, accessToken: string): Promise<string> {
  const url  = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${wikiToken}`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json() as {
    code: number; msg: string;
    data?: { node?: { obj_token?: string; obj_type?: string } };
  };
  if (json.code !== 0)
    throw new Error(`飞书 Wiki API 错误 (${json.code}): ${json.msg}`);
  const node = json.data?.node;
  if (!node?.obj_token)
    throw new Error("Wiki 节点未返回 obj_token，请确认该节点是多维表格类型");
  if (node.obj_type && node.obj_type !== "bitable")
    throw new Error(`Wiki 节点类型为 "${node.obj_type}"，非多维表格，无法同步`);
  return node.obj_token;
}

/** 从飞书字段构建 5 个默认考核指标 */
function buildIndicators(f: Record<string, unknown>) {
  return [
    { name: "项目投入指标（万元）",     content: cleanText(f["①项目投入指标（万元）"])    ?? "", owner: cleanText(f["①项目投入指标负责人"])   ?? null, isCustom: false, sortOrder: 0 },
    { name: "项目新增收入指标（万元）", content: cleanText(f["②项目新增收入指标（万元）"]) ?? "", owner: cleanText(f["②项目新增收入指标负责人"]) ?? null, isCustom: false, sortOrder: 1 },
    { name: "IP考核指标",             content: cleanText(f["③IP考核指标"])            ?? "", owner: cleanText(f["③IP指标负责人"])          ?? null, isCustom: false, sortOrder: 2 },
    { name: "技术考核指标",           content: cleanText(f["④技术考核指标"])          ?? "", owner: cleanText(f["④技术指标责任人"])         ?? null, isCustom: false, sortOrder: 3 },
    { name: "其他指标",              content: cleanText(f["⑤其他指标"])             ?? "", owner: cleanText(f["⑤其他指标责任人"])         ?? null, isCustom: false, sortOrder: 4 },
  ];
}

/**
 * 从飞书字段"待办事项"列构建待办列表
 * 若文本含换行符则拆成多条，每条一个 todo
 */
function buildTodos(f: Record<string, unknown>) {
  const raw = cleanText(f["待办事项"]);
  if (!raw) return [];
  return raw
    .split(/\n|\\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map((content, i) => ({ content, isCompleted: false, sortOrder: i }));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json() as { appToken?: string; tableId?: string; isWiki?: boolean };
  const { tableId, isWiki } = body;
  let { appToken } = body;

  if (!appToken?.trim() || !tableId?.trim())
    return NextResponse.json({ error: "appToken 和 tableId 不能为空" }, { status: 400 });

  appToken = appToken.trim();
  const cleanTableId = tableId.trim();
  const accessToken  = await getAppAccessToken();

  if (isWiki) {
    try { appToken = await resolveWikiToken(appToken, accessToken); }
    catch (e: unknown) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }

  // 分页拉取 Bitable 记录
  let allRecords: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${cleanTableId}/records`
    );
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res  = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json() as {
      code: number; msg: string;
      data?: { items?: { fields: Record<string, unknown> }[]; page_token?: string; has_more?: boolean };
    };
    if (json.code !== 0)
      return NextResponse.json({ error: `飞书 API 错误 (${json.code}): ${json.msg}` }, { status: 502 });

    allRecords = allRecords.concat((json.data?.items ?? []).map(i => i.fields));
    pageToken  = json.data?.has_more ? json.data.page_token : undefined;
  } while (pageToken);

  if (allRecords.length === 0)
    return NextResponse.json({ upserted: 0, message: "表格中没有记录" });

  // 打印第一条记录，用于调试字段映射
  if (allRecords[0]) {
    const f0 = allRecords[0];
    console.log("[import-bitable] 字段 keys:", Object.keys(f0));
    console.log("[import-bitable] 项目经理 raw:", JSON.stringify(f0["项目经理"]));
    console.log("[import-bitable] 项目经理 parsed:", extractFeishuText(f0["项目经理"]));
    console.log("[import-bitable] 项目负责人 raw:", JSON.stringify(f0["项目负责人"]));
    console.log("[import-bitable] 项目负责人 parsed:", extractFeishuText(f0["项目负责人"]));
    console.log("[import-bitable] 待办事项 raw:", JSON.stringify(f0["待办事项"]));
    console.log("[import-bitable] 待办事项 parsed:", extractFeishuText(f0["待办事项"]));
    console.log("[import-bitable] 备注 raw:", JSON.stringify(f0["备注"]));
    console.log("[import-bitable] 研究开发任务 raw:", JSON.stringify(f0["研究开发任务"]));
  }

  let upserted = 0;
  for (const f of allRecords) {
    const nameStr = cleanText(f["项目名称"]);
    if (!nameStr) continue;

    const base = {
      level:          cleanText(f["级别"])          ?? "",
      status:         cleanText(f["项目进度"])       ?? "未开始",
      applyDate:      toDate(f["申报时间"]),
      projectCode:    cleanText(f["立项名称"]),
      isWeekFocus:    extractFeishuText(f["周重点"]).trim() === "是",
      startDate:      toDate(f["开始时间"]),
      midCheckDate:   toDate(f["中期验收时间"]),
      endDate:        toDate(f["结项时间"]),
      totalSubsidy:   cleanFloat(f["补贴总额（万元）"]),
      received:       cleanFloat(f["已到账（万元）"]) ?? 0,
      projectOwner:   cleanText(f["项目负责人"]),
      projectManager: cleanText(f["项目经理"]),
      rdTask:         cleanText(f["研究开发任务"]),
      remark:         cleanText(f["备注"]),
      processRecord:  cleanText(f["过程记录"]),
      deletedAt:      null,
    };

    const indicators = buildIndicators(f);
    const todos      = buildTodos(f);

    // 打印解析后的 payload（仅前 3 条）
    if (upserted < 3) {
      console.log(`[import-bitable] 项目="${nameStr}" todos=${JSON.stringify(todos)} indicators_content=[${indicators.map(i => `"${i.content}"`).join(",")}]`);
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.majorProject.findUnique({ where: { name: nameStr } });

      if (existing) {
        await tx.projectIndicator.deleteMany({ where: { projectId: existing.id } });
        await tx.projectTodo.deleteMany({ where: { projectId: existing.id } });
        await tx.majorProject.update({
          where: { id: existing.id },
          data: {
            ...base,
            indicators: { create: indicators },
            todos:      { create: todos },
          },
        });
      } else {
        await tx.majorProject.create({
          data: {
            name: nameStr,
            ...base,
            indicators: { create: indicators },
            todos:      { create: todos },
          },
        });
      }
    });

    upserted++;
  }

  console.log(`[import-bitable] 同步完成，共处理 ${upserted} 条记录`);
  return NextResponse.json({ upserted });
}
