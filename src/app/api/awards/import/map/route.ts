/**
 * POST /api/awards/import/map
 * AI 辅助字段映射：将用户表格的非标准列名映射到标准数据库字段
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateResponse } from "@/lib/llm";

const STANDARD_FIELDS = [
  { key: "title",           desc: "奖项/资质全称" },
  { key: "awardedAt",       desc: "获得时间（年份或日期，如 2023 / 2023-06 / 2023-06-15）" },
  { key: "awardedBy",       desc: "授予单位/颁发机构" },
  { key: "awardeeEntity",   desc: "获奖主体（公司名称）" },
  { key: "category",        desc: "类别：AWARD=政府行业奖项 / QUALIFICATION=资质认证 / HONOR=荣誉称号" },
  { key: "importanceLevel", desc: "重要性等级（1-5，5最高）" },
  { key: "regionLabel",     desc: "地区标签（省/市）" },
  { key: "description",     desc: "描述或备注" },
  { key: "sourceFeishuUrl", desc: "飞书原始记录链接" },
];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { columns, sampleRows } = await req.json() as {
    columns: string[];
    sampleRows: string[][];
  };

  if (!Array.isArray(columns) || columns.length === 0)
    return NextResponse.json({ error: "列名不能为空" }, { status: 400 });

  const prompt = `你是一个数据字段映射助手。请将以下用户表格的列名映射到标准数据库字段。

标准字段列表（key: 含义）：
${STANDARD_FIELDS.map(f => `- ${f.key}: ${f.desc}`).join("\n")}

用户表格列名：${JSON.stringify(columns)}

前2行样例数据：
${sampleRows.slice(0, 2).map((r, i) => `第${i + 1}行: ${JSON.stringify(r)}`).join("\n")}

请输出一个 JSON 对象，格式为 { "用户列名": "标准字段key 或 null（无法映射时）" }。
只输出 JSON，不要任何解释或 Markdown 代码块。

映射规则：
- "得奖时间"/"获奖年份"/"时间"/"年份" → awardedAt
- "奖项名称"/"名称"/"称号"/"认证名"/"资质名称" → title
- "颁发单位"/"授予单位"/"颁奖机构"/"机构" → awardedBy
- "获奖主体"/"主体"/"公司"/"单位名称" → awardeeEntity
- "类别"/"类型"/"分类" → category
- "重要性"/"等级"/"星级"/"含金量" → importanceLevel
- "地区"/"省市"/"区域" → regionLabel
- "备注"/"描述"/"说明" → description`;

  try {
    const raw = await generateResponse(prompt);
    // 尝试从响应中提取 JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 未返回有效 JSON");
    const mapping = JSON.parse(match[0]) as Record<string, string | null>;
    return NextResponse.json({ mapping, fields: STANDARD_FIELDS });
  } catch (err) {
    // 降级：按顺序简单映射
    const fallback: Record<string, string | null> = {};
    const fieldKeys = STANDARD_FIELDS.map(f => f.key);
    columns.forEach((col, i) => {
      fallback[col] = fieldKeys[i] ?? null;
    });
    return NextResponse.json({ mapping: fallback, fields: STANDARD_FIELDS, fallback: true });
  }
}
