# 飞书 SSO 启用指南

> PA-Platform **已经内置**飞书 SSO 代码（`src/lib/auth.ts` 的 `FeishuProvider` + `signIn` 回调），
> 启用条件：**只要 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 两个环境变量有值，登录页就会出现"用飞书登录"按钮。**
>
> 本指南只讲**启用步骤**和**账号映射策略**，不写代码。

---

## 启用步骤（10 分钟）

### 步骤 1：飞书应用配置 OAuth 重定向 URL

1. 飞书应用后台（https://open.feishu.cn/app）→ 选你的 PA-Platform 应用
2. **安全设置** → **重定向 URL**：
   ```
   https://pa-platform-xxx.vercel.app/api/auth/callback/feishu
   ```
   把 `pa-platform-xxx.vercel.app` 换成你的真实 Vercel 域名
3. 保存

### 步骤 2：飞书应用开通权限

最小集：
- `contact:user.id:readonly`（读取用户 open_id）
- `contact:user.email:readonly`（读取邮箱）
- `contact:user.basic_profile:readonly`（读取姓名 / 头像）

可选：
- `contact:user.phone:readonly`
- 部门相关的（如果要用飞书部门树）

### 步骤 3：Vercel 环境变量

Vercel → Settings → Environment Variables：

| 变量 | 值 |
|---|---|
| `FEISHU_APP_ID` | `cli_xxxxxxxxxx`（飞书 App ID） |
| `FEISHU_APP_SECRET` | （飞书 App Secret） |

保存后 Vercel 自动重新部署，约 2 分钟生效。

### 步骤 4：验证

1. 打开 `https://pa-platform-xxx.vercel.app/login`
2. 现在应该有**两个登录入口**：
   - "账号密码"（原来的输入框）
   - "用飞书登录"（新出现的按钮）
3. 点飞书登录 → 跳到飞书授权页 → 同意 → 跳回 PA-Platform
4. 首次登录会**自动创建账号**（DEPT_CONTACT 角色）

---

## 账号映射策略

飞书用户首次登录时，`src/lib/auth.ts` 的 `signIn` 回调按以下**三级查找**创建 / 关联账号：

```
飞书用户首次登录
       │
       ▼
① 查本地 users 表的 feishuUserId = open_id
       │ 找到 → 用现成账号（绑定成功）
       │
       ▼ 找不到
② 查 feishuUnionId = union_id
       │ 找到 → 用现成账号（绑定成功）
       │
       ▼ 找不到
③ 查 email = 飞书邮箱
       │ 找到 → 用现成账号，并补绑 open_id / union_id（管理员预创建账号的兜底）
       │
       ▼ 找不到
④ 自动创建新 users 行
   - role = DEPT_CONTACT（最低权限）
   - email = 飞书邮箱（或 open_id@feishu.local 兜底）
   - 无 passwordHash（只能飞书登录，不能账号密码登录）
```

### 演示账号 + 飞书登录的兼容方案

现有演示账号（viewer01 / party-member / party-admin）创建时**没有**填 `feishuUserId`，
所以飞书用户首次登录**不会**匹配到这些账号。

#### 方案 1：演示账号不动，飞书账号新开（推荐用于演示）

- 演示账号继续用账号密码登录
- 飞书用户登录后**自动新建一个 DEPT_CONTACT 账号**（权限最低）
- 演示时：分别用 4 个账号密码登录演示，飞书账号作为"真实用户"演示

#### 方案 2：手动关联飞书用户到演示账号

把飞书的 `open_id` / `union_id` / `email` 之一填到演示账号的对应字段：

```sql
UPDATE users
SET feishu_user_id = 'ou_xxx'  -- 从飞书 admin API 或用户首次登录后的数据库查
WHERE email = 'viewer01@ruiqishenkong.com';
```

填好后该飞书用户登录就会落到 viewer01 账号上。

#### 方案 3：飞书邮箱跟演示账号邮箱对齐

如果你公司飞书账号的邮箱能改，改成：
- `viewer01@ruiqishenkong.com`
- `party-member@ruiqishenkong.com`
- `party-admin@ruiqishenkong.com`

但这些邮箱在你公司不一定收得到邮件，慎用。

---

## 飞书用户的权限

飞书用户首次登录默认是 **DEPT_CONTACT**（最低权限角色），看不到任何模块入口。

要让他们能看到模块：

**方式 1**：超级管理员在「侧边栏菜单」配置里给他们的飞书邮箱**加白名单**：
- 用户首次登录后看 DB 拿到 email
- 进「超级后台 → 侧边栏菜单」→ 找到 `accountWhitelist` → 加 `{ "email@company.com": ["major-projects", "awards", ...] }`

**方式 2**：让他们的飞书账号关联到一个有权限的部门（DEPT_CONTACT 角色根据部门挂权限）。

**方式 3**：手动 SQL 升级角色：
```sql
UPDATE users
SET role = 'PA_SPECIALIST', has_party_module_access = true
WHERE email = 'xxx@company.com';
```

---

## 飞书 SSO + iframe 嵌入的限制

如果飞书工作台用 iframe 嵌入 Vercel 上的 PA-Platform：

- ✅ NextAuth session cookie 是 `__Secure-next-auth.session-token`，跨 iframe 通常正常
- ⚠️ 飞书内置浏览器有时禁用第三方 cookie → SSO 登录可能失效
- ⚠️ 飞书 iFrame 内 PA-Platform 看不到外层 cookie（如飞书自己的 `tt_domain`）

**建议**：演示用**"新窗口打开"**模式，避免 iframe 兼容性坑。

---

## 关闭 SSO

临时关掉飞书登录：

```powershell
# Vercel → Settings → Environment Variables
# 把 FEISHU_APP_ID 改成 "disabled" 或清空
```

代码里 `src/lib/auth.ts` 的判断逻辑：

```ts
...(process.env.FEISHU_APP_ID
  ? [FeishuProvider({ ... })]
  : []),
```

只要环境变量没值，FeishuProvider 就不挂载，"用飞书登录"按钮就消失。

---

## 完整启用检查清单

- [ ] 飞书应用 OAuth 重定向 URL 已加 Vercel URL
- [ ] 飞书应用权限已开通 `contact:user.*` 三个 scope
- [ ] Vercel 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 已填
- [ ] Vercel 已重新部署
- [ ] `/login` 页面能看到"用飞书登录"按钮
- [ ] 测试登录：飞书用户首次登录能进 dashboard
- [ ] DB 里 `users` 表有该飞书用户的新行
- [ ] 超级管理员进「侧边栏菜单」给新用户加白名单（如果需要他们看到模块）

---

## 排错

### Q: 点了"用飞书登录"提示 redirect_uri 不匹配？
A: 飞书后台的"重定向 URL"没加 Vercel 的 callback URL，或大小写不匹配。
   必须是：`https://pa-platform-xxx.vercel.app/api/auth/callback/feishu`

### Q: 飞书授权完跳回 PA-Platform 但 session 是空的？
A: 99% 是 `NEXTAUTH_URL` 没配置成 HTTPS。NextAuth cookie 在 secure + non-HTTPS 下会被浏览器拒收。

### Q: 飞书用户首次登录后看不到任何菜单？
A: 正常。新建的飞书用户是 DEPT_CONTACT 角色，没部门，没白名单。需要超级管理员配置。

### Q: 想让飞书管理员直接登录超级管理员账号？
A: 把超级管理员账号的 `feishu_user_id` 改成管理员的 open_id。⚠️ 不建议演示场景这么做，会让"超级管理员"和"飞书管理员"耦合。
