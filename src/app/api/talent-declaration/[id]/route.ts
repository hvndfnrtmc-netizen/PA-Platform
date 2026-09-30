/**
 * GET   /api/talent-declaration/[id]  — 获取单个项目
 * PATCH /api/talent-declaration/[id]  — 更新项目
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  const project = await prisma.talentProject.findFirst({
    where: { id, deletedAt: null },
  });

  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  return NextResponse.json(project);
}

// ── PATCH ──────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  if (body.name !== undefined) {
    if (!String(body.name).trim()) {
      return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
    }
  }

  if (body.policyLinks !== undefined && !Array.isArray(body.policyLinks)) {
    return NextResponse.json({ error: "policyLinks 格式错误" }, { status: 400 });
  }
  if (body.policySections !== undefined && !Array.isArray(body.policySections)) {
    return NextResponse.json({ error: "policySections 格式错误" }, { status: 400 });
  }
  if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
    return NextResponse.json({ error: "attachments 格式错误" }, { status: 400 });
  }
  if (body.cloudAttachments !== undefined && !Array.isArray(body.cloudAttachments)) {
    return NextResponse.json({ error: "cloudAttachments 格式错误" }, { status: 400 });
  }
  if (body.declarationNodes !== undefined && !Array.isArray(body.declarationNodes)) {
    return NextResponse.json({ error: "declarationNodes 格式错误" }, { status: 400 });
  }

  const existing = await prisma.talentProject.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  // 明确只传入已知字段，防止废弃字段污染；所有字段均用条件展开，避免显式 undefined 触发 Prisma Invalid invocation
  const updateData: Parameters<typeof prisma.talentProject.update>[0]["data"] = {
    ...(body.name !== undefined              && { name:                 String(body.name).trim() }),
    ...(body.level !== undefined             && { level:                String(body.level) }),
    ...(body.region !== undefined            && { region:               String(body.region) }),
    ...(body.applicationUrl !== undefined    && { applicationUrl:       (body.applicationUrl as string) || null }),
    ...(body.wechatContactInfo !== undefined && { wechatContactInfo:    (body.wechatContactInfo as string) || null }),
    ...(body.declarationFrequency !== undefined && { declarationFrequency: (body.declarationFrequency as string) || null }),
    ...(body.cycleRuleConfig !== undefined   && { cycleRuleConfig:      body.cycleRuleConfig ?? Prisma.JsonNull }),
    ...(body.currentNode !== undefined       && { currentNode:          (body.currentNode as string) || null }),
    ...(body.policyDescription !== undefined && { policyDescription:    (body.policyDescription as string) || null }),
    ...(body.policySections !== undefined    && { policySections:       body.policySections as object[] }),
    ...(body.policyLinks !== undefined       && { policyLinks:          body.policyLinks as object[] }),
    ...(body.attachments !== undefined       && { attachments:          body.attachments as object[] }),
    ...(body.cloudAttachments !== undefined  && { cloudAttachments:     body.cloudAttachments as object[] }),
    ...(body.declarationNodes !== undefined  && { declarationNodes:     body.declarationNodes as object[] }),
    ...(body.defaultOwnerId !== undefined    && { defaultOwnerId:       (body.defaultOwnerId as string) || null }),
    ...(body.isKeyProject !== undefined      && { isKeyProject:         Boolean(body.isKeyProject) }),
  };

  try {
    const project = await prisma.talentProject.update({ where: { id }, data: updateData });
    return NextResponse.json(project);
  } catch (error) {
    console.error("【基础信息保存失败详情】:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `保存失败：${msg}` }, { status: 500 });
  }
}
