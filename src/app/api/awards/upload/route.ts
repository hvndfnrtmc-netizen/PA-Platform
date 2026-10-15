/**
 * POST /api/awards/upload
 *
 * 接收前端上传的证明附件（图片/PDF），写入 Supabase Storage，
 * 返回 Public URL 供前端直接存入 attachments 字段。
 *
 * 所需环境变量（在 .env 和 Vercel 控制台中配置）：
 *   SUPABASE_SERVICE_ROLE_KEY  —— 从 Supabase Dashboard > Settings > API 获取
 *   DATABASE_URL               —— 已配置，项目 ID 自动从中解析
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** 提取 Supabase 项目 ID：优先从 SUPABASE_URL 解析，兼容非 Supabase 数据库（如 Neon） */
function getProjectRef(): string {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const m1 = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (m1) return m1[1];
  const url   = process.env.DATABASE_URL ?? "";
  const match = url.match(/postgres\.([a-z0-9]+):/);
  return match?.[1] ?? "";
}

const BUCKET      = "awards-proofs";
const MAX_BYTES   = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "image/heic", "image/heif", "application/pdf",
];

export async function POST(req: NextRequest) {
  // ── 鉴权 ──────────────────────────────────────────────────────
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  // ── 环境变量检查 ───────────────────────────────────────────────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectRef = getProjectRef();
  if (!serviceKey || !projectRef) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY 未配置，请联系管理员在 .env 中添加该变量（从 Supabase Dashboard > Settings > API 获取）" },
      { status: 500 }
    );
  }

  // ── 解析 FormData ──────────────────────────────────────────────
  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  if (!file)
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });

  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "文件超过 50 MB 限制" }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type))
    return NextResponse.json({ error: "仅支持 JPG/PNG/WEBP/GIF/HEIC 图片和 PDF" }, { status: 400 });

  // ── 生成安全文件名 ─────────────────────────────────────────────
  const ext      = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path     = `${Date.now()}_${safeName}`;

  const supabaseBase = `https://${projectRef}.supabase.co/storage/v1`;

  // ── 确保 bucket 存在（幂等操作，已存在时忽略 409）────────────────
  await fetch(`${supabaseBase}/bucket`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });

  // ── 上传文件 ───────────────────────────────────────────────────
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
    console.error("[Awards Upload] Supabase error:", errBody);
    return NextResponse.json({ error: "文件上传到 Supabase 失败，请检查 Service Role Key 是否正确" }, { status: 502 });
  }

  const publicUrl = `${supabaseBase}/object/public/${BUCKET}/${path}`;
  const type      = file.type.startsWith("image/") ? "image" : "pdf";

  return NextResponse.json({ url: publicUrl, name: file.name, type });
}
