/**
 * PATCH /api/agreement/qualitative/[id] — 更新质性义务状态（editor+）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type P = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const role = session.user.role ?? "";
  if (!["SUPER_ADMIN", "ADMIN", "admin", "EDITOR", "editor"].includes(role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;

  let body: { status?: string; description?: string; evidenceUrls?: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  const existing = await prisma.qualitativeObligation.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const row = await prisma.qualitativeObligation.update({
    where: { id },
    data: {
      ...(body.status       !== undefined && { status:       body.status }),
      ...(body.description  !== undefined && { description:  body.description }),
      ...(body.evidenceUrls !== undefined && { evidenceUrls: body.evidenceUrls as unknown as object[] }),
      updatedById: session.user.id,
    },
  });

  return NextResponse.json(row);
}
