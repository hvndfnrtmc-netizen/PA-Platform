/**
 * Supabase Storage 服务端上传工具
 *
 * 环境变量：
 *   SUPABASE_URL              — Supabase 项目 URL
 *   SUPABASE_SERVICE_ROLE_KEY — 服务端 Service Role 密钥（勿暴露给客户端）
 */

import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase 环境变量未配置：请在 .env 中设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * 将文件上传至 Supabase Storage，返回公开访问 URL。
 *
 * @param file       File / Blob 对象
 * @param fileName   原始文件名（用于推断扩展名）
 * @param mimeType   MIME 类型，如 "application/pdf"
 * @param bucket     目标 Bucket 名称（默认 "pa-platform-files"）
 * @returns          文件的公开 URL
 */
export async function uploadFileToSupabase(
  file:     File | Blob,
  fileName: string,
  mimeType: string,
  bucket  = "pa-platform-files",
): Promise<string> {
  const supabase = getAdmin();

  // 生成唯一存储路径
  const ext    = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";
  const uid    = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path   = `agreements/${uid}${ext ? `.${ext}` : ""}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: mimeType, upsert: false });

  if (error) {
    throw new Error(`文件上传至 Supabase Storage 失败: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
