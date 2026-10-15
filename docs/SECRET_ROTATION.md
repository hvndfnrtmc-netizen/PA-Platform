# SECRET_ROTATION.md — 密钥轮换清单

> 部署到新环境（Vercel / Neon / 新服务器）时，**以下密钥必须重新生成**。
> 直接复制本地 `.env` 会导致：(a) 历史加密资产无法解密 (b) NextAuth session 失效。

---

## 必须重新生成（⚠️ 不能复用本地值）

### 1. `NEXTAUTH_SECRET`

**为什么**：NextAuth 用它签名 JWT session cookie。本地签名密钥和线上不一致，所有现有 session 都会失效（用户要重新登录）。

**生成命令**（任选其一）：
```bash
openssl rand -base64 32
```
```powershell
# PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

**填到**：Vercel → Settings → Environment Variables → `NEXTAUTH_SECRET`

---

### 2. `ASSET_ENCRYPTION_KEY`

**为什么**：用于 AES-256-GCM 加密资产（如上传文件、敏感字段）。密钥变了，所有旧加密数据**全部无法解密**。

**生成命令**：
```bash
openssl rand -hex 32
```

**填到**：Vercel → Settings → Environment Variables → `ASSET_ENCRYPTION_KEY`

**当前代码引用**：`src/lib/*` 内对 `process.env.ASSET_ENCRYPTION_KEY` 的引用（grep 一下）。
如果该项目**实际并未使用** ASSET_ENCRYPTION_KEY（`grep -r ASSET_ENCRYPTION_KEY src/` 没命中），可暂时跳过。

---

### 3. `ADMIN_PASSWORD`

**为什么**：本地虚拟账号密码。线上建议用独立的强密码。

**生成方式**：自己起一个 ≥16 位的强密码，例如：
```
Adm!n_Pa_Platform_2026_Sec
```

**填到**：Vercel → Settings → Environment Variables → `ADMIN_PASSWORD`

**线上登录后**：用 `prisma create-virtual-admin` 的脚本**不会自动跑**——超级管理员账号在数据迁移时已经导入到 Neon 了，密码哈希是 bcrypt 格式，**线上和本地共用同一个哈希**。如果想换线上密码，重新跑一遍脚本生成新哈希并 update 该用户即可。

---

## 演示账号密码

数据迁移时直接连哈希一起搬过来，**不需要重新生成**。

> ⚠️ 本节内容不上公网：实际密码写在 `scripts/create-demo-accounts.ts` 顶部 `DEMO_PASSWORD` 常量里。
> 如果要重新生成，直接改这个常量 + 重跑 `node ./node_modules/tsx/dist/cli.mjs scripts/create-demo-accounts.ts` 即可（脚本幂等）。

---

## 数据库连接串（`DATABASE_URL`）

每个环境都不一样，必须重新填：

| 环境 | 来源 |
|---|---|
| 本地 dev | `postgresql://postgres@localhost:5432/pa_platform` |
| Vercel Production | Neon / Supabase / Vercel Postgres 控制台拿到的连接串 |
| Vercel Preview | 可与 Production 共用，也可单独建一个 `pa_platform_preview` 库 |

⚠️ **必须带 `?sslmode=require`**，否则 Neon 会拒连。

---

## 可选（启用飞书 SSO 时必填）

### `FEISHU_APP_ID` / `FEISHU_APP_SECRET`

**来源**：https://open.feishu.cn/app → 创建企业自建应用 → 凭证页

**当前是 placeholder**（`cli_placeholder_dev`），线上不要用。

---

### 飞书机器人 webhook

**来源**：飞书群聊 → 设置 → 群机器人 → 添加 Webhook → 复制 URL

**注意**：webhook 是群级别的，换群就要重新拿。

---

## 加密资产迁移（如果有使用 `ASSET_ENCRYPTION_KEY`）

⚠️ 密钥换了，**所有旧加密数据必须重新加密**。

迁移方案：
1. 列出所有加密字段（grep 代码）
2. 写一次性脚本：用旧密钥解密 → 用新密钥加密
3. 在停机窗口跑完

如果你确认 PA-Platform 当前**没有**实际使用 `ASSET_ENCRYPTION_KEY`（搜源码无引用），可跳过这步。

---

## 安全提醒

1. **永远不要把 `.env` commit 到 git** —— 当前 `.gitignore` 已经忽略了 `.env*`，但 `.env.example` 里的所有 `CHANGE_ME` 占位符也要替换
2. **Vercel Dashboard 的 Environment Variables 是加密存储**，但只有 Owner/Admin 可见
3. **轮换密钥后**：旧 session 全部失效，强制所有用户重新登录
4. **生产泄露处理**：立刻在 Vercel 改值 → 重新部署 → 通知用户改密码
