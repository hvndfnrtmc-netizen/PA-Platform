/**
 * POST /api/party-transfer/upload  — 党员材料文件上传到 Supabase Storage
 *
 * Body: multipart/form-data
 *   file     : File    (≤ 50 MB)
 *   category : string  文件所属材料类别（如 "入党申请书"）
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession }               from "@/lib/auth";
import { createClient }             from "@supabase/supabase-js";

const BUCKET = "party-materials";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "无法解析表单数据" }, { status: 400 }); }

  const file     = formData.get("file")     as File   | null;
  const category = formData.get("category") as string | null;

  if (!file)     return NextResponse.json({ error: "未选择文件" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "缺少 category 字段" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "文件超过 50 MB 限制" }, { status: 400 });

  // 构建存储路径：使用 UUID 避免中文 category 导致 Supabase Invalid Key 错误
  const ext         = file.name.split(".").pop() ?? "bin";
  const safeFileName = `${crypto.randomUUID()}.${ext}`;
  const storagePath  = `party-transfers/${session.user.id}/${safeFileName}`;

  const supabase = getSupabase();

  // 确保 bucket 存在（首次使用时自动创建）
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find(b => b.name === BUCKET)) {
    await supabase.storage.createBucket(BUCKET, { public: true });
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || `application/${ext}`,
      upsert: false,
    });

  if (uploadError)
    return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return NextResponse.json({
    url:          urlData.publicUrl,
    name:         file.name,
    originalName: file.name,
    path:         storagePath,
  });
}
