# PA-Platform 部署到 Vercel — 完整 Playbook

> 本指南面向"演示用"部署：把本地 PG 数据搬上云，让 PA-Platform 通过公网 URL 稳定运行，
> 不再受本地 dev 进程被沙箱/休眠杀掉的影响。

---

## 0. 前置条件检查（10 分钟）

| 项 | 要求 |
|---|---|
| GitHub 账号 | 已有 repo: `hvndfnrtmc-netizen/PA-Platform` ✅ |
| Vercel 账号 | 待注册（免费层够用） |
| 托管 PG | 待选（推荐 Neon） |
| 本地 PG | 必须在跑（导出数据用） |
| 信用卡 | Vercel / Neon 免费层都**不要**信用卡 |

---

## 1. 创建 Neon 数据库（5 分钟）⭐ 推荐

> Neon 免费层：0.5 GB 存储、自动休眠、PostgreSQL 15+、自带 pgweb 控制台。

1. 打开 https://console.neon.tech/signup
2. 用 GitHub 登录（**用同一个 GitHub 账号**，授权更顺畅）
3. 创建项目：`pa-platform`（Region 选 **Asia Pacific (Singapore)** 或 **US East (Ohio)**，都行）
4. 在 Dashboard 找到 **Connection Details**，选 "Connection string"：
   ```
   postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/pa_platform?sslmode=require
   ```
5. **复制完整连接串**，待会儿填到 Vercel 的 `DATABASE_URL` 环境变量

**备选方案**（不需要 Neon 时）：
- **Vercel Postgres**（Storage tab 里的 Postgres）— 一站式，但免费层较小
- **Supabase**（不只是 DB，还有 Auth/Storage）— 免费层 500MB
- 自建：略

---

## 2. 创建 Vercel 账号 + 链接 GitHub（3 分钟）

1. 打开 https://vercel.com/signup
2. **Continue with GitHub**（用同一个 GitHub 账号）
3. 授权 Vercel 访问你的 GitHub（建议只授权 `PA-Platform` repo）
4. 完成 onboarding

---

## 3. 把当前所有改动 commit + push 到 GitHub（5 分钟）

### 3.1 我会帮你把代码 commit 好（已经在沙箱里准备）

你需要做的是 **push 到 GitHub**。在项目根目录 `C:\Users\admin\PA-Platform`：

```bat
git add -A
git commit -m "feat: deployment prep — sidebar config / readonly mode / vercel config"
git push origin main
```

> 第一次 push 如果失败（认证问题），去 https://github.com/settings/tokens 生成 Personal Access Token (classic) 拿来当密码用。

### 3.2 验证 GitHub 上有最新代码

打开 https://github.com/hvndfnrtmc-netizen/PA-Platform 看 commit 历史，最新一条应该是带部署准备的。

---

## 4. 在 Vercel 导入项目（5 分钟）

1. 打开 https://vercel.com/new
2. 选 **Import Git Repository** → 找到 `PA-Platform` → 点 Import
3. **Project Name**: 填 `pa-platform`（或你喜欢的名字，最终 URL 是 `xxx.vercel.app`）
4. **Framework Preset**: 自动识别为 **Next.js**，不用改
5. **Build & Output Settings**:
   - Build Command: `npm run build`（默认）
   - Output Directory: `.next`（默认）
   - Install Command: `npm install --legacy-peer-deps` ← **改成这个**，否则 Prisma 7 的依赖可能 peer 警告失败
6. **Root Directory**: 留空（项目根）
7. **不要点 Deploy**，先配环境变量（下一步）

---

## 5. 配置环境变量（5 分钟）🔒

Vercel 项目页 → **Settings** → **Environment Variables**，按下面表格填：

| 变量名 | 值（填法） | 说明 |
|---|---|---|
| `DATABASE_URL` | Neon 拿到的连接串 | ⚠️ 必须带 `?sslmode=require` |
| `NEXT_PUBLIC_APP_URL` | 先填 `https://pa-platform.vercel.app`，部署后再回来改成真实 URL | |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` 重新生成 | ⚠️ 不能用本地那个 |
| `NEXTAUTH_URL` | 同 `NEXT_PUBLIC_APP_URL` | |
| `ASSET_ENCRYPTION_KEY` | `openssl rand -hex 32` 重新生成 | ⚠️ 不能用本地那个（详见 SECRET_ROTATION.md） |
| `FEISHU_APP_ID` | 留空或填 `cli_placeholder` | 待飞书 SSO 启用时再改 |
| `FEISHU_APP_SECRET` | 同上 | |
| `FEISHU_BOT_WEBHOOK` | 同上 | |
| `FEISHU_RECEPTION_NOTIFY_CHAT_ID` | 同上 | |
| `ABP_LLM_API_KEY` | 留空 | 无 AI 需求可不管 |
| `ABP_LLM_BASE_URL` | 留空 | |
| `ABP_MODEL_NAME` | 留空 | |
| `ADMIN_PASSWORD` | 重新生成强密码 | ⚠️ 务必在 `.env` 中替换为你自己的密码；本仓库的演示账号密码参考 `scripts/create-demo-accounts.ts` 顶部的 `DEMO_PASSWORD` 常量 |

**勾选 Environment**：Production / Preview / Development **全选**（演示用不需要分级）。

⚠️ **重启前**——点击 **Deploy** 按钮开始第一次构建。

---

## 6. 第一次部署（3-5 分钟）

1. 点 **Deploy**
2. 等 build 通过。常见错误：
   - `prisma generate` 失败 → 检查 install command 是否带了 `--legacy-peer-deps`
   - Prisma engine binary 缺失 → 在 `prisma/schema.prisma` 的 generator 里加 `binaryTargets = ["native", "rhel-openssl-3.0.x"]`
   - TypeScript 错误 → 看 build log
3. 成功后 Vercel 给你一个 URL：`https://pa-platform-xxx.vercel.app`
4. **打开看看**——大概率会看到数据库报错（因为 Neon 是空的），这正常，继续下一步

---

## 7. 把本地数据迁到 Neon（5 分钟）

### 7.1 在本地导出 PG

打开 PowerShell：
```powershell
cd C:\Users\admin\PA-Platform
node ./node_modules/tsx/dist/cli.mjs --env-file=.env scripts/dump-pg-to-file.ts pg-dump-prod.sql
```

输出 `pg-dump-prod.sql` 在项目根。

### 7.2 把 schema push 到 Neon（创建空表）

把 Neon 的 DATABASE_URL 临时放到 `.env.production`（**不要 commit**）：
```bat
copy .env.example .env.production
notepad .env.production
```
改成：
```
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/pa_platform?sslmode=require"
```

保存后跑：
```powershell
node ./node_modules/tsx/dist/cli.mjs --env-file=.env.production prisma\..\node_modules\prisma\build\index.js db push
```

或：
```powershell
npx prisma db push --schema=./prisma/schema.prisma
```
（需要 npm 装到 PATH 的 npx）

### 7.3 把数据灌到 Neon

```powershell
node ./node_modules/tsx/dist/cli.mjs --env-file=.env.production scripts/restore-pg-from-file.ts pg-dump-prod.sql
```

成功后 Neon 里就有 admin + 3 个演示账号 + 所有历史数据。

---

## 8. 验证生产部署（5 分钟）

打开 `https://pa-platform-xxx.vercel.app/login`，依次用以下账号验证（**密码在你本地 `.env` 与 `scripts/create-demo-accounts.ts` 里**，不要提交到 GitHub）：

1. ✅ 用超级管理员账号登录（账号密码在 `.env` 的 `ADMIN_PASSWORD` 字段） → 进 dashboard
2. ✅ 切到「演示·查阅账号」（viewer01）→ 看到只读模式（顶部黄横幅 + 表单灰化）
3. ✅ 切到「演示·党员（提交端）」（party-member）→ 看到党员关系提交端
4. ✅ 切到「演示·党员关系管理员」（party-admin）→ 看到审批工作台

全部正常 → 部署完成 🎉

---

## 9. 后续：飞书工作台接入

详见 **FEISHU_WORKBENCH.md**

---

## 10. 常见问题

### Q: 部署后 502 / Database error?
A: 99% 是 `DATABASE_URL` 没填对。回 Vercel → Settings → Environment Variables 检查。
   必须带 `?sslmode=require`。
   Neon 的 connection string 在 Dashboard → Connection Details → "Pooled connection"。

### Q: 文档上传后刷新就没了?
A: 正常。Vercel 文件系统是临时的，要接 Vercel Blob。详见 STORAGE_ON_VERCEL.md。

### Q: 演示账号看不到对应的模块?
A: `sidebar_menu_config` 是跟着 DB 走的。导出 dump 时已经包含了，重启 dev 也能看到。

### Q: Build 时报 `PrismaClientInitializationError`?
A: 在 `prisma/schema.prisma` 的 generator 里加：
   ```prisma
   generator client {
     provider      = "prisma-client-js"
     binaryTargets = ["native", "rhel-openssl-3.0.x"]
   }
   ```
   然后重新部署。

### Q: 怎么回滚?
A: Vercel → Deployments → 选上一个 working 版本 → 右上角 "..." → Promote to Production。

### Q: 想用自定义域名?
A: Vercel → Settings → Domains → 添加 `pa.yourcompany.com`，按提示改 DNS。

---

## 11. 卸载/清理

- **临时关掉**：Vercel → Project → Settings → General → "Delete Project"
- **保留数据**：Neon 数据库不动，下次重新部署还能用
- **彻底清理**：Neon Console → Project → Settings → Delete Project

---

## 12. 时间 & 成本预估

| 项 | 时间 | 成本 |
|---|---|---|
| Neon 注册 + 建库 | 5 分钟 | 0 元 |
| Vercel 注册 | 2 分钟 | 0 元 |
| 环境变量配置 | 10 分钟 | 0 元 |
| 数据迁移 | 10 分钟 | 0 元 |
| 飞书工作台接入 | 10 分钟 | 0 元 |
| **合计** | **~40 分钟** | **0 元/月**（除非上传超过 500MB 文档到 Vercel Blob） |
