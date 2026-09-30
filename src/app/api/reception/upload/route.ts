/**
 * POST /api/reception/upload
 * 上传政府接待附件（调研文件 / 会议纪要）到 Supabase Storage，返回 FileItem。
 *
 * 所需环境变量：
 *   SUPABASE_URL               —— Supabase Dashboard > Settings > API（如 https://xxx.supabase.co）
 *   SUPABASE_SERVICE_ROLE_KEY  —— Supabase Dashboard > Settings > API
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const BUCKET    = "reception-files";
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "image/heic", "image/heif", "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      { error: `环境变量缺失：${!supabaseUrl ? "SUPABASE_URL" : "SUPABASE_SERVICE_ROLE_KEY"} 未配置，请在 Vercel 项目设置中添加` },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "文件超过 20 MB 限制" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type))
    return NextResponse.json({ error: "不支持该文件格式，仅支持图片、PDF、Office 文档、TXT" }, { status: 400 });

  const ext         = file.name.includes(".") ? file.name.split(".").pop()!.replace(/[^a-zA-Z0-9]/g, "") : "";
  const storagePath = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;
  const supabaseBase = `${supabaseUrl}/storage/v1`;

  // 确保 bucket 存在（幂等，忽略"已存在"错误）
  await fetch(`${supabaseBase}/bucket`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });

  const buffer    = Buffer.from(await file.arrayBuffer());
  const uploadRes = await fetch(`${supabaseBase}/object/${BUCKET}/${storagePath}`, {
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
    console.error("[Reception Upload] Supabase error:", uploadRes.status, errBody);
    return NextResponse.json(
      { error: `文件上传失败（Supabase ${uploadRes.status}）：${errBody.slice(0, 200)}` },
      { status: 502 }
    );
  }

  const publicUrl = `${supabaseBase}/object/public/${BUCKET}/${storagePath}`;
  return NextResponse.json({
    type: "local",
    name: file.name,
    url:  publicUrl,
    size: file.size,
  });
}
