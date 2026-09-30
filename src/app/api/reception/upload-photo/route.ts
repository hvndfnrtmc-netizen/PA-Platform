/**
 * POST /api/reception/upload-photo
 *
 * 两步上传方案（绕过 Vercel 4.5MB 请求体限制）：
 * 1. 前端 POST { filename, contentType, fileSize } 到此接口
 * 2. 后端生成 Supabase 签名上传 URL 并返回给前端
 * 3. 前端直接 PUT 文件到 Supabase（不经过 Vercel）
 * 4. 前端使用后端返回的 publicUrl 保存到数据库
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";

export const runtime = 'nodejs';
export const maxDuration = 30;

const BUCKET    = "reception-files";
const MAX_BYTES = 10 * 1024 * 1024; // 10MB（前端直传，不受 Vercel 限制）
const ALLOWED   = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/bmp"];

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (session.user.role === "DEPT_CONTACT") return NextResponse.json({ error: "权限不足" }, { status: 403 });

    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
    if (!serviceKey || !supabaseUrl)
      return NextResponse.json({ error: "存储服务未配置" }, { status: 500 });

    const body = await req.json() as { filename?: string; contentType?: string; fileSize?: number };
    const { filename = "photo", contentType = "", fileSize = 0 } = body;

    if (!ALLOWED.includes(contentType))
      return NextResponse.json({ error: "仅支持图片格式（JPG/PNG/WEBP/GIF/HEIC）" }, { status: 400 });
    if (fileSize > MAX_BYTES)
      return NextResponse.json({ error: `图片超过 ${MAX_BYTES / 1024 / 1024}MB 限制` }, { status: 400 });

    // Task 3: 路径不带前导斜杠
    const ext      = filename.includes(".") ? filename.split(".").pop()!.replace(/[^a-zA-Z0-9]/g, "") : "jpg";
    const filePath = `photos/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Task 2: ✅ 正确：使用专用于生成上传签名链接的 API（而非 createSignedUrl）
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error("生成签名URL失败:", error);
      return NextResponse.json({ error: `生成上传链接失败：${error.message}` }, { status: 502 });
    }

    // Task 4: 正确解析 signedUrl 并返回前端所需字段
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    return NextResponse.json({
      uploadUrl: data.signedUrl,
      publicUrl: publicUrlData.publicUrl,
      contentType,
    });
  } catch (e) {
    console.error("生成上传链接异常:", e);
    return NextResponse.json({
      error: e instanceof Error ? e.message : "生成上传链接失败，请稍后重试"
    }, { status: 500 });
  }
}
