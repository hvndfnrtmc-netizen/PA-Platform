# 飞书工作台接入指南

> 把部署在 Vercel 上的 PA-Platform "装"到飞书侧边栏，让用户像打开飞书原生应用一样打开它。

---

## 前提条件

- ✅ PA-Platform 已经成功部署到 Vercel（详见 DEPLOY_TO_VERCEL.md）
- ✅ 你（或你公司）有飞书**管理员**权限
- ✅ 拿到 Vercel 部署后的 HTTPS URL，例如：`https://pa-platform-xxx.vercel.app`

---

## 步骤 1：飞书管理员后台创建应用（5 分钟）

1. 打开 https://open.feishu.cn/app （或企业版入口 https://open.feishu.cn/app）
2. 右上角 **创建企业自建应用**
3. 填写基本信息：
   - **应用名称**：PA-Platform（或你喜欢的名字，例如"瑞启深空协同平台"）
   - **应用描述**：一句话简介
   - **应用图标**：上传一个图标（建议尺寸 256×256）
4. 创建后进入应用详情，记下两个值：
   - **App ID**：`cli_xxxxxxxxxx`
   - **App Secret**：（点"查看"获取）
5. 进入 **权限管理**，按需开通（演示用最小集）：
   - `contact:user.id:readonly`（读取用户基本信息，可选）
   - 不开也能跑，演示账号用 NextAuth 独立登录即可

---

## 步骤 2：把应用发布到工作台（3 分钟）

1. 应用详情 → **应用发布** → **版本管理与发布**
2. 点 **创建版本**，版本号 `1.0.0`，备注写"初始版本"
3. 提交审核（企业内部自建应用通常自动通过，或管理员一键通过）
4. 审核通过后，应用会出现在你公司的飞书 **工作台**

---

## 步骤 3：配置"网页应用"入口（5 分钟）

有两种集成方式，选一种：

### 方式 A：网页应用（**推荐，演示用**）

1. 进入 **应用功能** → **网页应用** → 启用
2. **配置主页**：
   - **桌面端主页 URL**：`https://pa-platform-xxx.vercel.app/dashboard`
   - **移动端主页 URL**：同上（Vercel 自带响应式）
3. **权限设置**：
   - 可见范围：选"全体员工"或指定部门
4. 保存

**优点**：用户在飞书里点应用卡片 → 直接打开 PA-Platform，UI 一体化最强。

**缺点**：默认会套飞书的浏览器壳（带"飞书"标题栏和"返回飞书"按钮），用户感知是"在飞书里打开"。

### 方式 B：自定义机器人 / 消息卡片

通过飞书机器人发送卡片消息，用户点卡片跳转 URL。

适合：定向推送任务通知、特定群组使用。

---

## 步骤 4：飞书用户看到应用（1 分钟）

1. 用户打开飞书客户端（左下角"工作台"或顶部"应用"）
2. 找到 **PA-Platform** 应用卡片
3. 点击 → 在飞书内置浏览器里打开 → 进登录页
4. 用 `admin@ruiqishenkong.com` / `RqAdmin2026!` 登录（演示账号也一样）

---

## 步骤 5：填回 Vercel 环境变量（1 分钟）

把第 1 步拿到的 `App ID` / `App Secret` 填回 Vercel：

| 变量 | 值 |
|---|---|
| `FEISHU_APP_ID` | `cli_xxxxxxxxxx` |
| `FEISHU_APP_SECRET` | （你的 secret） |

保存后 Vercel 会自动触发一次**新部署**（不需要手动 deploy）。

---

## 可选：用"飞书内打开"模式（iFrame 集成）

如果你希望 PA-Platform 在飞书**完全嵌入**而不是"新窗口打开"：

1. 应用功能 → **机器人** → 启用
2. 用 **消息卡片** + `href` 跳转到 Vercel URL，飞书会用 iFrame 包裹
3. 需要在 `next.config.ts` 里允许飞书域名的 iframe：
   ```ts
   async headers() {
     return [{
       source: "/(.*)",
       headers: [
         {
           key: "Content-Security-Policy",
           value: "frame-ancestors 'self' https://*.feishu.cn https://*.larksuite.com",
         },
       ],
     }];
   }
   ```
4. 注意：iFrame 内 PA-Platform 的 cookie 共享 / SSO 要单独配置（详见 FEISHU_SSO.md）

---

## 步骤 6：权限分配（1 分钟）

飞书管理员后台 → **成员与部门** → 选部门 → **应用权限** → 勾选 PA-Platform

或者全局开通：应用详情 → **可见范围** → "全员"

---

## 验证清单

部署完成后逐一验证：

- [ ] 飞书工作台能看到 PA-Platform 应用卡片
- [ ] 点击卡片能打开 PA-Platform 登录页（带飞书浏览器壳）
- [ ] 用 admin 账号能登录并看到所有菜单
- [ ] 用 viewer01 登录能看到只读模式
- [ ] 用 party-member / party-admin 登录能看到党员关系模块
- [ ] 关闭浏览器再打开，session 仍然有效（说明 NextAuth cookie 跨飞书浏览器也能保持）

---

## 常见问题

### Q: 工作台看不到刚发布的应用？
A: 飞书客户端需要刷新（Mac: Cmd+R，Win: F5），或者重新登录。
   也可能是"可见范围"被限定到特定部门，让管理员检查。

### Q: 点开应用是空白页？
A: Vercel 部署的 URL 还没生效，或者 `NEXTAUTH_URL` 没配置成 HTTPS。
   Vercel 默认带 HTTPS，确认 `NEXTAUTH_URL` 是 `https://...` 而不是 `http://`。

### Q: 用户点开应用想登录，提示"账号不存在"？
A: NextAuth Credentials 是用本地账号密码登录的，跟飞书账号**没有自动关联**。
   解决办法：要么启用 FEISHU_SSO.md 的方案，要么让用户用 `admin@ruiqishenkong.com` 这种独立账号。

### Q: 在飞书里点"退出登录"后，应用卡片还是显示登录状态？
A: NextAuth 的 cookie 域不对。`NEXTAUTH_URL` 必须是部署后的 HTTPS URL，
   不要用 localhost 或 Vercel 内部域名。

---

## 下一步

- 想做"飞书扫码登录"：见 **FEISHU_SSO.md**
- 想自定义应用图标 / 描述：在飞书应用后台编辑
- 想让特定部门才能用：调整"可见范围"
