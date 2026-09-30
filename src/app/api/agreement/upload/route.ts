/**
 * POST /api/agreement/upload — 上传协议文件到 Supabase Storage（editor+）
 * Body: FormData { file: File, name: string, category: string, year?: string, remark?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploadFileToSupabase } from "@/lib/supabase-storage";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const role = session.user.role ?? "";
  if (!["SUPER_ADMIN", "ADMIN", "admin", "EDITOR", "editor"].includes(role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求体格式错误，需要 multipart/form-data" }, { status: 400 });
  }

  const file     = fd.get("file")     as File   | null;
  const name     = (fd.get("name")    as string | null)?.trim();
  const category = (fd.get("category") as string | null) ?? "other";
  const yearStr  =  fd.get("year")    as string | null;
  const remark   = (fd.get("remark")  as string | null) || undefined;

  if (!file || file.size === 0) return NextResponse.json({ error: "文件内容不能为空" }, { status: 400 });
  if (!name)                    return NextResponse.json({ error: "文件名不能为空" },   { status: 400 });
  if (file.size > MAX_SIZE)     return NextResponse.json({ error: "文件大小不能超过 50 MB" }, { status: 400 });

  // 上传至 Supabase Storage
  let url: string;
  try {
    url = await uploadFileToSupabase(file, name, file.type || "application/octet-stream");
  } catch (e) {
    console.error("[upload] Supabase Storage 错误:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // 写入数据库（仅存元数据 + URL，不存 base64）
  const record = await prisma.agreementFile.create({
    data: {
      name,
      url,
      size:       file.size,
      mimeType:   file.type || null,
      category,
      year:       yearStr ? parseInt(yearStr) : null,
      remark:     remark ?? null,
      uploadedBy: session.user.id,
    },
  });

  return NextResponse.json({ id: record.id, name: record.name, url: record.url }, { status: 201 });
}
