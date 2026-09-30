/**
 * GET  /api/talent-declaration  — 人才申报项目列表
 * POST /api/talent-declaration  — 新建项目
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const projects = await prisma.talentProject.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      companies: {
        where: { deletedAt: null },
        include: {
          cycles: {
            where: { deletedAt: null },
            include: {
              awardees: {
                include: { disbursements: true },
              },
            },
          },
        },
      },
    },
  });

  return NextResponse.json(projects);
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  if (!body.name || typeof body.name !== "string" || !String(body.name).trim()) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
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
  if (body.declarationNodes !== undefined && !Array.isArray(body.declarationNodes)) {
    return NextResponse.json({ error: "declarationNodes 格式错误" }, { status: 400 });
  }

  try {
    const project = await prisma.talentProject.create({
      data: {
        name:                 String(body.name).trim(),
        level:                String(body.level || "国家级"),
        region:               String(body.region || ""),
        applicationUrl:       (body.applicationUrl as string) || null,
        wechatContactInfo:    (body.wechatContactInfo as string) || null,
        declarationFrequency: (body.declarationFrequency as string) || null,
        cycleRuleConfig:      body.cycleRuleConfig ?? Prisma.JsonNull,
        currentNode:          (body.currentNode as string) || null,
        declarationNodes:     (body.declarationNodes as object[]) ?? [],
        policyDescription:    (body.policyDescription as string) || null,
        policySections:       (body.policySections as object[]) ?? [],
        policyLinks:          (body.policyLinks as object[]) ?? [],
        attachments:          (body.attachments as object[]) ?? [],
        defaultOwnerId:       (body.defaultOwnerId as string) || null,
      },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("【基础信息保存失败详情】:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `保存失败：${msg}` }, { status: 500 });
  }
}
