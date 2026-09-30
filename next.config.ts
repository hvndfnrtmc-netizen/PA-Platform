import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // 防止父目录的 package-lock.json 被误识别为 workspace root
    root: path.resolve(__dirname),
  },
  // 不打包 Prisma：让 Node.js 原生解析 #main-entry-point package imports
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  // 支持大文件上传（最大 500MB）
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
