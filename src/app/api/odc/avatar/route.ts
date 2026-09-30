/**
 * POST /api/odc/avatar
 * 上传 ODC 领导班子头像到 Supabase Storage，返回公开 URL。
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const BUCKET    = "odc-avatars";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });

  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      { error: `环境变量缺失：${!supabaseUrl ? "SUPABASE_URL" : "SUPABASE_SERVICE_ROLE_KEY"} 未配置` },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "头像文件不能超过 5 MB" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type))
    return NextResponse.json({ error: "仅支持 JPEG / PNG / WebP / GIF 格式" }, { status: 400 });

  const ext         = file.name.includes(".") ? file.name.split(".").pop()!.replace(/[^a-zA-Z0-9]/g, "") : "jpg";
  const storagePath = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const supabaseBase = `${supabaseUrl}/storage/v1`;

  // 确保 bucket 存在（幂等）
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
    return NextResponse.json(
      { error: `上传失败（Supabase ${uploadRes.status}）：${errBody.slice(0, 200)}` },
      { status: 502 }
    );
  }

  const publicUrl = `${supabaseBase}/object/public/${BUCKET}/${storagePath}`;
  return NextResponse.json({ url: publicUrl });
}
