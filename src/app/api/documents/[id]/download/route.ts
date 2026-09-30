/**
 * GET /api/documents/[id]/download
 * 下载已生成的公文文件
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc)            return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  if (!doc.outputFile) return NextResponse.json({ error: "文件尚未生成" }, { status: 404 });

  const filePath = path.join(process.cwd(), UPLOAD_DIR, doc.outputFile);
  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "文件不存在，可能已被删除" }, { status: 404 });
  }

  const filename = encodeURIComponent(`${doc.title}.docx`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
