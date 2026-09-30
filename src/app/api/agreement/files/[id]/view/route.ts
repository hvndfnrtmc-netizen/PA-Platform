/**
 * GET /api/agreement/files/[id]/view?download=1 — 预览或下载文件
 *
 * 优先检查 `url` 字段（Supabase Storage），重定向到真实文件地址；
 * 兼容旧记录：若只有 `data`（base64），则直接返回二进制流。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type P = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const file = await prisma.agreementFile.findUnique({ where: { id } });

  if (!file) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  // ── 新路径：Supabase Storage URL ──────────────────────────────
  if (file.url) {
    const isDownload = req.nextUrl.searchParams.get("download") === "1";
    if (isDownload) {
      // 让浏览器以附件形式下载（通过 Content-Disposition header 代理）
      const upstream = await fetch(file.url);
      if (!upstream.ok) {
        return NextResponse.json({ error: "文件下载失败" }, { status: 502 });
      }
      const blob = await upstream.arrayBuffer();
      return new NextResponse(blob, {
        headers: {
          "Content-Type":        file.mimeType ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
          "Content-Length":      String(blob.byteLength),
          "Cache-Control":       "private, max-age=3600",
        },
      });
    }
    // 预览：直接重定向到 Supabase 公开 URL
    return NextResponse.redirect(file.url, 302);
  }

  // ── 旧路径：base64 存 DB（兼容历史记录）──────────────────────
  if (!file.data) return NextResponse.json({ error: "文件内容为空" }, { status: 404 });

  const buf        = Buffer.from(file.data, "base64");
  const isDownload = req.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(buf, {
    headers: {
      "Content-Type":        file.mimeType ?? "application/octet-stream",
      "Content-Disposition": isDownload
        ? `attachment; filename="${encodeURIComponent(file.name)}"`
        : `inline; filename="${encodeURIComponent(file.name)}"`,
      "Content-Length":      String(buf.byteLength),
      "Cache-Control":       "private, max-age=3600",
    },
  });
}
