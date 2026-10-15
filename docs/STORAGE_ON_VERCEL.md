# STORAGE_ON_VERCEL.md — Vercel 上的文件存储方案

> ⚠️ **Vercel 的文件系统是临时的**——任何 `fs.writeFile` 保存的文件，
> 在 serverless 函数结束后就**会消失**。下一次冷启动 / 不同实例 / 重新部署，文件全部丢失。
>
> 所以 PA-Platform 当前在 `src/app/api/documents/*` 里的 `fs.writeFile`
> **直接部署到 Vercel 上传文档会立即失效**。
>
> 本文档列三种解决方案，按推荐度排序。

---

## 方案 A：Vercel Blob（⭐ 推荐，最简单）

**优点**：原生集成、一行代码上传 / 下载 / 删除、有 500MB 免费层。

**缺点**：免费层只有 500MB，演示够用，长期生产略紧张。

### A.1 启用 Blob

1. Vercel → Project → **Storage** tab → **Create Database** → 选 **Blob** → 命名 `pa-platform-blob` → 创建
2. Vercel 自动注入环境变量 `BLOB_READ_WRITE_TOKEN`（**不需要你手动填**）

### A.2 安装依赖

```powershell
cd C:\Users\admin\PA-Platform
npm install @vercel/blob
```

### A.3 代码改造（约 10 行改动，2 个文件）

#### `src/app/api/documents/upload/route.ts`

替换 `writeFile` 部分：
```ts
// 旧：
const templateDir = path.join(process.cwd(), UPLOAD_DIR, "templates");
await mkdir(templateDir, { recursive: true });
const templatePath = path.join(templateDir, `${doc.id}.docx`);
await writeFile(templatePath, buf);

// 新：
import { put } from "@vercel/blob";

const blob = await put(`templates/${doc.id}.docx`, buf, {
  access: "public",         // 演示用 public；生产建议 "private" + 下发签名 URL
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});
// 把 blob.url 存到 doc.templateFile
await prisma.document.update({
  where: { id: doc.id },
  data: { templateFile: blob.url },
});
```

#### `src/app/api/documents/[id]/render/route.ts`

同理，生成文档后用 `put` 上传，URL 存 DB。

#### `src/app/api/documents/[id]/download/route.ts`

读出 `templateFile` URL，`fetch(blobUrl)` 流式返回。

### A.4 本地开发

Vercel Blob 在本地也能用——自动 fallback 到 `.vercel/blob` 目录。
装好 `@vercel/blob` 后 `npm run dev` 即可。

---

## 方案 B：Cloudflare R2（长期生产更便宜）

**优点**：10 GB 免费、$0.015/GB/月、S3 兼容、可以和 Cloudflare CDN 集成。

**缺点**：要绑卡（虽然免费层不收费，但要预授权 $1）、配置稍复杂。

### B.1 创建 R2 bucket

1. https://dash.cloudflare.com → R2 → Create bucket `pa-platform-docs`
2. 拿到 **S3 endpoint**：`https://ACCOUNT_ID.r2.cloudflarestorage.com`
3. R2 → Manage R2 API Tokens → Create API token，权限 "Object Read & Write"，scope 选你的 bucket
4. 拿到 `access_key_id` 和 `secret_access_key`

### B.2 安装 AWS SDK

```powershell
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### B.3 代码改造

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

await s3.send(new PutObjectCommand({
  Bucket: process.env.R2_BUCKET!,
  Key: `templates/${doc.id}.docx`,
  Body: buf,
  ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}));
// 存 URL：https://PA_DOMAIN/templates/xxx.docx（配自定义域名）或直接用 S3 endpoint URL
```

### B.4 Vercel 环境变量

| 变量 | 值 |
|---|---|
| `R2_ENDPOINT` | `https://ACCOUNT_ID.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | xxx |
| `R2_SECRET_ACCESS_KEY` | xxx |
| `R2_BUCKET` | `pa-platform-docs` |
| `R2_PUBLIC_URL` | 自定义域名或 `https://pub-xxx.r2.dev` |

---

## 方案 C：保持本地（❌ 不推荐）

代码完全不动，直接部署。

**后果**：
- 用户上传的 .docx 模板在**下一次 Vercel 函数冷启动时丢失**
- 生成的文档也丢失
- 每次重新部署全部历史文档丢失

**只适合**：纯演示，且不需要演示"上传文档"功能。

如果接受这个限制，把 .env 的 `UPLOAD_DIR` 设成 `/tmp/uploads`（Vercel 唯一可写的目录，但仍不持久）。

---

## 推荐选择

| 场景 | 推荐方案 |
|---|---|
| **快速验证部署流程** | 方案 C（先不接存储，文档功能跳过） |
| **演示完整功能** | 方案 A（Vercel Blob） |
| **长期生产 / 文档量大** | 方案 B（Cloudflare R2） |
| **跟 Vercel Postgres 配套** | 方案 A |
| **想顺便存头像 / 头像等小文件** | 方案 A（统一管） |

---

## 实施建议

我的建议：**先用方案 C 把 PA-Platform 跑起来**（10 分钟完成部署、跑通基本功能、验证演示账号），
**然后再花 30 分钟接方案 A**（Vercel Blob），让文档功能也能用。

这样分阶段的好处：
- 第一阶段出问题（schema 不对、env 写错）只影响主功能，不影响文档
- 第二阶段文档改造独立调试，与核心流程隔离
