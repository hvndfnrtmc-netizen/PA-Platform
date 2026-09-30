/**
 * POST /api/talent-declaration/[id]/companies/[cid]/cycles  — 新增申报周期
 * 支持 copyFromCycleId：深度克隆历史周期的节点/任务配置，并洗白所有状态。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type NodeTask = { isCompleted?: boolean; [key: string]: unknown };
type DeclarationNode = { status?: string; tasks?: NodeTask[]; [key: string]: unknown };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, cid } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "周期名称不能为空" }, { status: 400 });

  const company = await prisma.talentProjectCompany.findFirst({
    where: { id: cid, projectId: id, deletedAt: null },
  });
  if (!company) return NextResponse.json({ error: "公司不存在" }, { status: 404 });

  const copyFromCycleId = typeof body.copyFromCycleId === "string" ? body.copyFromCycleId.trim() : "";

  let initialNodes: object[] = [];
  let ownerId: string | null = null;
  let feishuGroupUrl: string | null = typeof body.feishuGroupUrl === "string" ? body.feishuGroupUrl || null : null;

  if (copyFromCycleId) {
    // ── 深度克隆历史周期配置 ──
    const sourceCycle = await prisma.talentProjectCycle.findUnique({
      where: { id: copyFromCycleId },
      select: { declarationNodes: true, ownerId: true, feishuGroupUrl: true },
    });

    if (!sourceCycle) {
      return NextResponse.json({ error: "所选历史周期不存在" }, { status: 404 });
    }

    // 深度克隆并洗白状态：重置 node.status 和 task.isCompleted
    if (Array.isArray(sourceCycle.declarationNodes)) {
      const sourceNodes = sourceCycle.declarationNodes as DeclarationNode[];
      initialNodes = sourceNodes.map(node => ({
        ...node,
        status: "未开始",
        tasks: Array.isArray(node.tasks)
          ? node.tasks.map((task: NodeTask) => ({ ...task, isCompleted: false }))
          : [],
      }));
    }

    // 继承历史周期的负责人和飞书群（前端没有传入 feishuGroupUrl 时才继承）
    ownerId = sourceCycle.ownerId ?? null;
    if (!feishuGroupUrl && sourceCycle.feishuGroupUrl) {
      feishuGroupUrl = sourceCycle.feishuGroupUrl;
    }
  } else {
    // ── 使用项目基础模板（原有逻辑） ──
    const project = await prisma.talentProject.findFirst({
      where: { id, deletedAt: null },
      select: { declarationNodes: true, defaultOwnerId: true },
    });

    if (Array.isArray(project?.declarationNodes)) {
      const templateNodes = project.declarationNodes as Array<{ id: string; name: string; startDate?: string; endDate?: string }>;
      for (const n of templateNodes) {
        initialNodes.push({ ...n, status: "pending", startDate: n.startDate ?? "", endDate: n.endDate ?? "", tasks: [] });
      }
    }

    ownerId = project?.defaultOwnerId ?? null;
  }

  const cycle = await prisma.talentProjectCycle.create({
    data: {
      companyId: cid,
      name,
      declarationNodes: initialNodes,
      ownerId,
      feishuGroupUrl,
    },
    include: {
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(cycle, { status: 201 });
}
