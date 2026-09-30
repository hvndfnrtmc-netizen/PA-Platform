@AGENTS.md

# Momenta PA Platform — Claude 操作守则

## 语言规范

- **始终用中文回复**，无论用户用何种语言提问。

## 任务执行前置规范（每次收到任务必须严格遵守）

### 核心准则 C：先出方案，确认后再动手

收到任何非trivial任务（改代码、改数据库、改配置、新增功能等），**必须先输出以下结构化方案，等待用户明确确认后才能开始操作**。操作完成后，用自然语言中文向用户说明改了什么。

**方案输出模板（七节结构）**：

---

## 一、代码现状摘要

- 列出所有涉及文件，注明路径和大致行数
- 用表格或列表描述当前关键逻辑/状态/数据结构

## 二、根因分析

- 逐条列出问题，标注"最可能 / 也可能 / 已确认"
- 每条根因附上代码定位（文件名 + 行号 + 关键代码片段）

## 三、修改方案

- 每个改动单独编号（改动 1、改动 2……）
- 注明修改位置（文件 + 函数名 + 行号）
- 给出改动前后的关键代码对比（before/after 代码块）

## 四、预期达成效果

- 用用户视角描述改动后的表现：**用户会看到什么、能做什么、不能做什么**
- 分场景列举（正常路径 / 边界情况 / 错误路径）
- 如有 UI 变化，描述按钮/提示/流程的具体变化
- 明确说明哪些现有功能**不受影响**

## 五、确认几个细节

- 列出方案中有歧义或需要用户决策的点
- 每个问题给出推荐选项

## 六、改动范围

- 改：列出会修改的文件及修改规模（~N 行）
- 不动：明确列出不会碰的文件/表/配置

## 七、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| ... | 低/中/高 | ... |

---

**你确认后我再动手。**（列出关键确认点）

---

**例外情形**（以下情况可直接操作，无需等待确认）：
- 用户明确说"直接做""不用确认""马上改"
- 纯文档/注释修改（不改代码逻辑）
- 修复明显的拼写/格式错误
- `npm run dev` / `npm run build` 等只读命令

## 全局核心工作流（每次唤醒必须严格遵守）

### 核心准则 A：部署（手动触发）

- **严禁自动部署**。只有用户明确说"部署"时才执行部署命令。
- 部署命令（按顺序）：
  ```bash
  cd C:\Users\nerida.gao\Desktop\Momenta-PA-Platform\pa-platform
  git remote remove origin
  vercel --prod --yes
  git remote add origin https://github.com/gaonerida-bit/PA-Platform.git
  ```

### 核心准则 B：代码备份脱钩

- Vercel 部署与 GitHub 备份彻底脱钩。GitHub 仅作为代码仓库，不再触发任何部署流水线。
- 日常开发中无需频繁 `git push`，由 `auto-backup.js` 定时脚本统一处理（每天 19:00 自动备份）。
- 启动定时备份：`npm run backup:start`（需在项目根目录运行，保持终端开启）。

## 工作目录

- 项目根目录：`C:\Users\nerida.gao\Desktop\Momenta-PA-Platform\pa-platform`
- 所有脚本、prisma 命令、npm 命令均在此目录下执行
- 执行任何命令前先确认 `pwd` 输出与上方一致；若不对，先 `cd` 到正确目录
- `package.json` 存在即为项目根目录标志

## 飞书 / Lark API 规范

- **正确域名**：`https://open.feishu.cn`（永远不要用 `passport.feishu.cn` 或其他变体）
- **用户搜索**：`GET https://open.feishu.cn/open-apis/search/v1/user`
- **发送消息**：`POST https://open.feishu.cn/open-apis/im/v1/messages`
- **获取用户 open_id**：`POST https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id`
- **Token 类型**：区分 tenant_access_token（应用级）和 user_access_token（用户级），错误 99991663 通常是 token 类型错误
- **不要访问飞书文档 URL**：网络受限，无法访问。使用上方已知端点，不要猜测不存在的 v2/v3 路径
- **错误码速查**：
  - `20001` → app_id 或 app_secret 错误
  - `20043` → 缺少对应 API 权限，在飞书开放平台控制台开启
  - `99991663` → token 类型不匹配，检查是否应用 tenant_access_token 还是 user_access_token
- **Card Builder 2.0**：本项目使用 `type: "card"` + `schema: "2.0"` 格式，不使用旧版 interactive 格式

## Prisma / 数据库守则

- **严禁 `npx prisma db pull`**，除非用户明确要求 —— 会用数据库现有结构覆盖 schema 文件，破坏手写逻辑
- **500 错误排查顺序**：先确认数据库可连接（`npx prisma db push` 或 `npx prisma studio`），再查 adapter 配置、外键等
- **Schema 修改后**：必须按顺序执行 `npx prisma generate` → `npx prisma db push`，不要跳过任何一步
- **生产数据库**：Supabase PostgreSQL，连接串在 `.env` 的 `DATABASE_URL`；本地开发用同一个或本地 PG
- **adapter**：项目同时引入了 `@prisma/adapter-pg`（Supabase）和 `@prisma/adapter-libsql`（Turso），根据 `.env` 判断当前使用哪个

## TypeScript & 构建规则

- **多文件修改后必须**：`npx tsc --noEmit`，零错误才算完成，不要在有 TS 错误的情况下部署
- **编辑大文件前**：先用 Read 工具读取完整内容，不要凭记忆或假设文件结构直接写入，避免内容重复或覆盖
- **Next.js 版本**：`16.2.4`（有 breaking changes，读 `node_modules/next/dist/docs/` 中相关指南）
- **路径别名**：项目使用 `@/*` 映射到 `src/*`

## Vercel 部署 Checklist

按顺序执行，任何一步失败立即停止并报告：

1. `npx tsc --noEmit` — 必须零错误
2. 确认 `package.json` scripts 中有 `"postinstall": "prisma generate"`（当前已有，勿删除）
3. `npm run build` — 本地构建验证
4. 部署：`vercel --prod --yes`
5. 若 `vercel env` CLI 失败，改用 REST API：
   ```bash
   curl -X POST "https://api.vercel.com/v10/projects/{PROJECT_ID}/env" \
     -H "Authorization: Bearer $VERCEL_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"key":"KEY","value":"VAL","type":"encrypted","target":["production"]}'
   ```
6. 部署完成后，验证关键端点（`curl -s -o /dev/null -w "%{http_code}" https://{url}/api/health`）
7. 未经验证端点实际返回正确响应，不得声称任务完成

## 诊断优先原则

**修代码之前，先列假设**：

1. 读取报错文件，运行失败命令，捕获完整错误输出
2. 列出 3 个按可能性排序的根因假设，附证据
3. 得到确认后再动代码

禁止：看到报错直接改代码 → 部署 → 看结果 → 再改 → 再部署的循环。

## 高危操作二次确认

以下操作执行前必须告知用户并等待确认：

- `prisma db push --force-reset`
- 删除任何生产数据
- `vercel env rm`（删除生产环境变量）
- 修改 `next-auth` 的 session/JWT 配置
- 任何涉及 `SystemConfig` 表的写操作（含 feishu_admin_open_id）
