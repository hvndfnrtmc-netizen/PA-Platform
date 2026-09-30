/**
 * POST /api/documents/upload
 * 上传 .docx 模板，检测占位符，保存记录
 * multipart/form-data: file=<docx>, title=<string>, taskId?=<string>
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { detectPlaceholders } from "@/lib/doc-builder";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const form = await req.formData();
  const file   = form.get("file") as File | null;
  const title  = (form.get("title") as string | null)?.trim();
  const taskId = (form.get("taskId") as string | null) ?? undefined;

  if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "模板名称不能为空" }, { status: 400 });
  if (!file.name.endsWith(".docx"))
    return NextResponse.json({ error: "仅支持 .docx 格式" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  // 先创建 DB 记录取得 id
  const doc = await prisma.document.create({
    data: {
      title,
      templateFile: "", // 占位，文件名用 id
      renderStatus: "PENDING",
      taskId:       taskId ?? null,
      createdById:  session.user.id,
    },
  });

  // 保存模板文件
  const templateDir = path.join(process.cwd(), UPLOAD_DIR, "templates");
  await mkdir(templateDir, { recursive: true });
  const templatePath = path.join(templateDir, `${doc.id}.docx`);
  await writeFile(templatePath, buf);

  // 检测占位符
  const keys = detectPlaceholders(buf);
  const placeholderMap: Record<string, null> = {};
  for (const k of keys) placeholderMap[k] = null;

  // 更新 DB
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      templateFile:   `templates/${doc.id}.docx`,
      placeholderMap: placeholderMap,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json(
    { document: updated, detectedPlaceholders: keys },
    { status: 201 }
  );
}
