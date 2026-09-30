# Changelog

本项目所有版本的重要变更记录，格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [v8.1] - 2026-08-11

### ✨ 功能改进

#### 党员关系转接 — 驳回体验重构

- **逐文件行内驳回理由**：废弃原来"单一弹窗填写整体驳回原因"的交互，改为在材料列表中对每个被标记为「驳回」的文件单独填写原因；"驳回申请"按钮在所有被驳回文件均填写原因后才变为可点击，按钮文案实时反馈当前状态（"请填写驳回原因" / "驳回申请"）。
- **驳回历史记录（多轮追溯）**：Prisma Schema 新增 `rejection_history`（`Json?`），以结构化 JSON 数组保存每轮驳回的时间戳与逐文件原因 `{ round, rejectedAt, files: [{ category, fileName, reason }] }`，支持完整审核轨迹查询。
- **申请人侧驳回提示升级**：被驳回文件行内展示对应的逐条驳回原因；新增"重新上传"快捷按钮，点击后自动移除旧文件并立即唤起文件选择器，减少操作步骤。
- **提交审核乐观更新（Optimistic Update）**：点击"提交审核"后 UI 立即切换至「待单位审核」状态并禁用按钮，不再等待服务端响应；若服务端报错则自动回滚至真实状态。
- **待审核状态按钮布局优化**：`STAGE1_SUBMITTED` 状态下，操作区由原来的单一"申请撤回修改"大按钮拆分为主按钮"⏳ 待单位审核"（不可点击，状态提示）+ 副按钮"↩️ 撤回"（功能保留），视觉层级更清晰。

---

### 🐛 问题修复

#### 党员关系转接 — 安全与一致性修复

- **防止重复提交（双重保护）**：
  - *前端*：`handleSubmitStage1` 增加状态守卫，若当前状态已为 `STAGE1_SUBMITTED` / `STAGE1_COMPANY_APPROVED` / `STAGE1_COMMITTEE_APPROVED` / `COMPLETED`，立即拦截并展示提示，不发起任何网络请求。
  - *后端*：`POST /api/party-transfer/record` 新增锁定逻辑，上述已提交状态的记录返回 `409 Conflict`，阻止数据覆盖；撤回请求（`stage1WithdrawRequested: true`）为唯一豁免例外。
- **拦截含未处理驳回文件的重新提交**：提交前校验 `uploadedFiles` 中是否存在仍处于 `REJECTED` 状态的文件；若有则阻止提交并展示"请先重新上传所有被驳回材料"错误提示。
- **`localStorage` 缓存污染修复**：`saveDraft` 在记录状态为非 `DRAFT` 时主动清除本地缓存（`localStorage.removeItem`），修复了页面刷新后因残留草稿缓存导致已提交状态被覆盖的问题。
- **驳回接口校验逻辑修正**：`PUT /api/party-transfer/record`（`action: "reject"`）改为从 `materialUpdates` 提取带 `rejectReason` 的被驳回文件进行校验；若无任何文件携带有效原因则返回 `400 Bad Request`，废弃旧的全局 `rejectReason` 字段。

---

## [v8.0] - 2026-07-30

### ✨ 功能改进

#### 党员关系模块 — Stage 1 完整状态机（铁桶模式）
- 定义并实现 5 个严格流转状态：`DRAFT` → `STAGE1_SUBMITTED` → `STAGE1_COMPANY_APPROVED` → `STAGE1_COMMITTEE_APPROVED` → `WITHDRAWN`
- Prisma Schema 新增 `stage1WithdrawRequested Boolean @default(false)` 标志字段，并推送至 Supabase 生产库
- `PUT /api/party-transfer/record` 扩展支持 `allow_stage1_withdraw` 动作：管理员同意后将 `status` 重置为 `DRAFT` 并清零标志位，`revalidatePath` 确保所有客户端缓存即时失效
- 管理员抽屉（`MaterialDrawer`）新增黄色撤回申请横幅（`stage1WithdrawRequested === true` 时渲染），含"同意撤回"一键操作按钮，操作中显示 loading 态
- 员工端（`UserTransferPortal`）新增 `handleStage1Withdraw` 函数，提交后设置 `stage1WithdrawRequested = true`，成功后展示 5 秒绿色提示条

#### 党员关系模块 — Stage 1 锁定逻辑精细化
- 新增 `isStage1Locked` 专用锁定判断，覆盖 `STAGE1_SUBMITTED` / `STAGE1_COMPANY_APPROVED` / `STAGE1_COMMITTEE_APPROVED` 三个已提交状态
- Stage 1 表单在上述三态下全部进入只读，与 `isGloballyLocked`（全局锁）逻辑彻底解耦

#### 产品文档更新
- `PRODUCT_CONTEXT.md` 补全目录（新增十四、十五、十六章节链接）
- 更新文档头部日期至 `2026-07-30`
- 新增 §十六：完整记录 v4.0 的 8 项功能改进与问题修复，供后续 AI 助手快速上下文接入

---

### 🐛 问题修复

#### Stage 1 安全漏洞：移除员工端自行重置状态的接口
- 原 `handleRequestReject` 函数可直接 `POST { status: "DRAFT" }` 绕过管理员审批，属于高危越权操作
- 已完全删除该函数及其关联的 `requestRejectOpen` / `requestRejectSending` state 与确认对话框 JSX
- 员工现在只能通过「申请撤回」→ 等待管理员审批的双重确认流程修改已提交表单

#### Stage 1 在党委批准后仍可编辑（状态机漏洞）
- 原 `isGloballyLocked` 仅覆盖 `STAGE1_SUBMITTED` 和 `STAGE1_COMPANY_APPROVED`，导致 `STAGE1_COMMITTEE_APPROVED` 状态下 Stage 1 表单仍处于可编辑状态
- 引入 `isStage1Locked` 补全覆盖，彻底修复提交后全程锁定逻辑

---

## [v4.0] - 2026-07-23

### ✨ 功能改进

#### 行政支持工单飞书自动化派发
- 新增专属飞书卡片（橙色主题），可一键发送至指定个人或群聊
- 发送目标通过「飞书通讻录」选择器选取，支持多选
- 群发场景下，新增「群内 @ 提醒」选择器，可指定群内人员接收 @通知
- 物资申请涵盖：热茶（杯）、矿泉水（瓶）、果盘、席卡壳子、展厅雨伞（把）
- 席卡壳子数量默认值改为与会人员总人数
- 会议时间单独传参，不再占用物资字段列表

#### 人才申报项目导航 — 双重胶囊筛选栏
- 移除搜索栏旁的地区/级别下拉选框
- 新增「地区」与「级别」两行独立胶囊按钮，样式与交互完全对齐
- 实现地区 × 级别自由联合过滤，互不干扰

#### 人才申报周期管理闭环
- 每个申报周期胶囊右侧新增 ⚙️ 设置入口
- 支持在弹窗内修改周期名称并实时保存
- 支持删除周期，含明确的二次确认弹窗（提示数据不可恢复）
- 删除后自动切换至剩余周期或清空选中状态

#### 政府接待 — 删除功能
- 表格视图支持多选记录后批量删除（带二次确认弹窗）
- 卡片视图每张卡片悬停时右上角显示删除按钮
- 底层新增 `DELETE /api/reception` 批量软删除端点

#### 飞书通知配置 — 快捷入口
- 飞书联系人同步区域新增「编辑飞书通讻录源表」外链按钮，直达多维表格源数据

---

### 🐛 问题修复

#### 新建申报周期点击「确认创建」无反应
- 「确认创建」按钮不再因字段未填而完全禁用，点击后统一触发校验逻辑
- 各必填字段未填时，在输入框下方渲染红色错误提示文字，不再静默失败
- 新增 `console.log` 打印校验状态，方便开发调试

#### 飞书多维表格同步 FieldNameNotFound
- Debug 日志格式统一为 `【飞书同步 payload fields】:`，便于终端检索
- 同步失败（code=1254045）时，错误信息末尾附加代码中所有列名，方便与飞书表头逐一核对

#### 文案与量词修正
- 行政支持工单：热茶单位「套」→「杯」；矿泉水单位「份」→「瓶」
- 行政支持工单：「保洁阿姨提前泡好」→「阿姨提前泡好」
- 飞书配置页面：修复多处「通讻录」错别字

---

## [v3.0] - 2024-06-29

政府接待功能上线（完整接待流程管理、飞书同步、待办任务等）。

---

## [v2.0] - 2024-05-06

平台首次正式上线。

---

## [v1.0] - 2024-04-30

项目初始代码建立。
