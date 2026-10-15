/**
 * POST /api/major-projects/upload
 *
 * 接收前端上传的证明材料（图片/PDF/Word），写入 Supabase Storage，
 * 返回 { id, name, url, type, size, uploadedAt } 供前端存入 proofMaterials 字段。
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

// 路由配置：延长超时以支持大文件上传
export const maxDuration = 300; // 5分钟

function getProjectRef(): string {
  // 优先从 SUPABASE_URL 解析，兼容非 Supabase 数据库（如 Neon）
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const m1 = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (m1) return m1[1];
  const url   = process.env.DATABASE_URL ?? "";
  const match = url.match(/postgres\.([a-z0-9]+):/);
  return match?.[1] ?? "";
}

const BUCKET    = "major-project-files";
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB - 支持大文件和资料包
const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "image/heic", "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip", // ZIP 压缩包
  "application/x-zip-compressed",
  "application/x-rar-compressed", // RAR 压缩包
  "application/x-7z-compressed", // 7Z 压缩包
];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectRef = getProjectRef();
  if (!serviceKey || !projectRef) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY 未配置" },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  if (!file)
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });

  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "文件超过 500 MB 限制" }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type))
    return NextResponse.json(
      { error: "不支持的文件类型，仅支持图片、PDF、Word、Excel、ZIP/RAR/7Z" },
      { status: 400 }
    );

  const ext       = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileId    = uuidv4();
  const path      = `${fileId}_${safeName}`;

  const supabaseBase = `https://${projectRef}.supabase.co/storage/v1`;

  // 确保 bucket 存在
  await fetch(`${supabaseBase}/bucket`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });

  // 上传文件
  const buffer    = Buffer.from(await file.arrayBuffer());
  const uploadRes = await fetch(`${supabaseBase}/object/${BUCKET}/${path}`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${serviceKey}`,
      "Content-Type": file.type,
      "x-upsert":     "true",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    console.error("[MajorProject Upload] Supabase error:", errBody);
    return NextResponse.json(
      { error: "文件上传失败，请检查 Service Role Key" },
      { status: 502 }
    );
  }

  const publicUrl = `${supabaseBase}/object/public/${BUCKET}/${path}`;

  let type: "image" | "pdf" | "doc" | "other" = "other";
  if (file.type.startsWith("image/")) type = "image";
  else if (file.type === "application/pdf") type = "pdf";
  else if (file.type.includes("word") || ext === "doc" || ext === "docx") type = "doc";

  return NextResponse.json({
    id:         fileId,
    name:       file.name,
    url:        publicUrl,
    type,
    size:       file.size,
    uploadedAt: new Date().toISOString(),
  });
}
