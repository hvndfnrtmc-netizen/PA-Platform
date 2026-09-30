-- ============================================================
-- Momenta PA 部门政企数据协同与智库平台
-- 原始 SQL 建表脚本（PostgreSQL 生产版）
-- 执行方式: psql $DATABASE_URL -f prisma/sql/init.sql
-- 注意: 推荐使用 Prisma migrate，此脚本仅供参考和应急使用
-- ============================================================

-- 启用 UUID 扩展（PostgreSQL）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ────────────────────────────────────────────
-- 枚举类型
-- ────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'PA_SPECIALIST', 'DEPT_CONTACT');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DepartmentType" AS ENUM ('PA', 'BUSINESS');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TaskType" AS ENUM ('PERIODIC', 'SPECIAL');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'PENDING', 'IN_PROGRESS', 'SUBMITTED', 'ARCHIVED', 'CANCELLED');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AssetCategory" AS ENUM ('FINANCIAL', 'ROAD_TEST', 'RD_PATENT', 'PERSONNEL', 'REGULATORY', 'MISC');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM (
    'LOGIN', 'LOGOUT', 'VIEW_DASHBOARD', 'VIEW_ASSET', 'EXPORT_ASSET',
    'CREATE_TASK', 'UPDATE_TASK', 'DELETE_TASK', 'ARCHIVE_TASK', 'LOCK_TASK',
    'CREATE_USER', 'UPDATE_USER', 'DELETE_USER',
    'CREATE_DEPARTMENT', 'UPDATE_DEPARTMENT', 'DELETE_DEPARTMENT',
    'UPLOAD_TEMPLATE', 'GENERATE_DOCUMENT', 'COPILOT_QUERY',
    'PERMISSION_CHANGE', 'GLOBAL_CONFIG'
  );
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────
-- 1. departments — 部门拓扑表（自引用树形）
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT        NOT NULL,
  code            TEXT        NOT NULL UNIQUE,
  type            "DepartmentType" NOT NULL DEFAULT 'BUSINESS',
  feishu_dept_id  TEXT        UNIQUE,
  parent_id       TEXT        REFERENCES departments(id),
  contact_user_id TEXT,                                 -- FK to users, added below
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  deleted_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE departments IS '部门拓扑表：支持多级树形结构，软删除防止历史数据丢失';
COMMENT ON COLUMN departments.code IS '部门唯一编码，如 FINANCE / RD / HR / LEGAL / PA';
COMMENT ON COLUMN departments.parent_id IS '上级部门 ID，NULL 表示顶层部门';
COMMENT ON COLUMN departments.is_active IS '软删除标志：FALSE 仅隐藏，数据保留';

-- ────────────────────────────────────────────
-- 2. users — 用户表
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  feishu_user_id  TEXT        UNIQUE,
  feishu_union_id TEXT        UNIQUE,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  avatar_url      TEXT,
  role            "UserRole"  NOT NULL DEFAULT 'DEPT_CONTACT',
  password_hash   TEXT,                                 -- NULL 表示纯飞书免密登录
  department_id   TEXT        REFERENCES departments(id),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  last_login_ip   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS '用户表：支持飞书 SSO 与本地账号双模式';
COMMENT ON COLUMN users.role IS 'SUPER_ADMIN=VP级全权限 | PA_SPECIALIST=PA专员 | DEPT_CONTACT=业务部门对接人';
COMMENT ON COLUMN users.feishu_user_id IS '飞书 open_id，飞书登录后写入';

-- departments.contact_user_id FK（延迟添加避免循环依赖）
ALTER TABLE departments
  ADD CONSTRAINT IF NOT EXISTS fk_dept_contact_user
  FOREIGN KEY (contact_user_id) REFERENCES users(id);

-- ────────────────────────────────────────────
-- 3. task_templates — 任务模板表
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_templates (
  id                    TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                  TEXT        NOT NULL,
  description           TEXT,
  type                  "TaskType"  NOT NULL DEFAULT 'PERIODIC',
  feishu_template_url   TEXT,
  feishu_template_token TEXT,
  fields_schema         JSONB,      -- [{ fieldKey, label, deptCode, unit, required }]
  cron_expression       TEXT,       -- e.g. "0 9 1 1,4,7,10 *"
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN task_templates.fields_schema IS 'JSON 数组，定义该模板需要哪些部门填写哪些字段';
COMMENT ON COLUMN task_templates.cron_expression IS '周期任务触发时间，标准 5 字段 Cron';

-- ────────────────────────────────────────────
-- 4. tasks — 任务表
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id                          TEXT          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title                       TEXT          NOT NULL,
  description                 TEXT,
  type                        "TaskType"    NOT NULL DEFAULT 'SPECIAL',
  status                      "TaskStatus"  NOT NULL DEFAULT 'DRAFT',
  template_id                 TEXT          REFERENCES task_templates(id),
  feishu_sheet_url            TEXT,
  feishu_spreadsheet_token    TEXT,
  feishu_spreadsheet_sheet_id TEXT,
  deadline                    TIMESTAMPTZ,
  archived_at                 TIMESTAMPTZ,
  locked_at                   TIMESTAMPTZ,
  locked_by_id                TEXT          REFERENCES users(id),
  deleted_at                  TIMESTAMPTZ,
  created_by_id               TEXT          NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

COMMENT ON TABLE tasks IS '任务表：支持周期任务与专项任务双轨制，软删除';
COMMENT ON COLUMN tasks.feishu_spreadsheet_token IS '飞书表格唯一 Token，用于调用飞书 API 管理权限';

-- ────────────────────────────────────────────
-- 5. task_assignments — 任务分配表（任务 <-> 部门）
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_assignments (
  id                    TEXT              NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id               TEXT              NOT NULL REFERENCES tasks(id),
  department_id         TEXT              NOT NULL REFERENCES departments(id),
  status                "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
  feishu_card_message_id TEXT,            -- 飞书填报卡片 message_id，用于更新卡片
  feishu_sheet_ranges   JSONB,            -- [{ sheetId, range }] 用于权限降级
  submitted_at          TIMESTAMPTZ,
  reviewer_id           TEXT              REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  review_note           TEXT,
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, department_id)
);

COMMENT ON TABLE task_assignments IS '任务-部门分配表：记录每个部门的填报状态，驱动飞书卡片状态看板';
COMMENT ON COLUMN task_assignments.feishu_sheet_ranges IS '归档后降权时使用，指定该部门可编辑的 Sheet 范围';

-- ────────────────────────────────────────────
-- 6. assets — 核心资产大盘表
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assets (
  id               TEXT           NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metric_key       TEXT           NOT NULL,     -- e.g. "2025_Q1_total_patents"
  metric_name      TEXT           NOT NULL,     -- 显示名称
  category         "AssetCategory" NOT NULL DEFAULT 'MISC',
  value            TEXT           NOT NULL,     -- 统一字符串，应用层转换
  unit             TEXT,
  period           TEXT           NOT NULL,     -- "2025-Q1" / "2025-01" / "2025"
  period_label     TEXT           NOT NULL,     -- "2025年第一季度"
  source_task_id   TEXT           REFERENCES tasks(id),
  source_feishu_url TEXT,                       -- 原始飞书文档 URL（AI 溯源必带）
  source_cell_ref  TEXT,                        -- 飞书 Sheet 单元格定位
  confidence       FLOAT          NOT NULL DEFAULT 1.0,
  is_encrypted     BOOLEAN        NOT NULL DEFAULT FALSE,
  encrypted_value  TEXT,                        -- AES-256-GCM 密文（高机密指标）
  created_by_id    TEXT           NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (metric_key, period)
);

CREATE INDEX IF NOT EXISTS idx_assets_category_period ON assets(category, period);
CREATE INDEX IF NOT EXISTS idx_assets_metric_key ON assets(metric_key);

COMMENT ON TABLE assets IS '核心资产大盘表：所有归档提取的结构化指标，AI Copilot 问答的溯源底座';
COMMENT ON COLUMN assets.source_feishu_url IS '原飞书文档 URL，AI 每条回答必须携带，实现严格防幻觉';
COMMENT ON COLUMN assets.encrypted_value IS '高机密指标 AES-256-GCM 密文，密钥由 KMS 管理';

-- ────────────────────────────────────────────
-- 7. asset_versions — 资产版本历史表
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_versions (
  id            TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asset_id      TEXT        NOT NULL REFERENCES assets(id),
  old_value     TEXT        NOT NULL,
  new_value     TEXT        NOT NULL,
  change_reason TEXT,
  changed_by_id TEXT        NOT NULL REFERENCES users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_versions_asset_id ON asset_versions(asset_id, changed_at DESC);

COMMENT ON TABLE asset_versions IS '资产变更历史：每次数值修改留痕，支持回溯与争议核查';

-- ────────────────────────────────────────────
-- 8. documents — 公文生成记录表
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title           TEXT        NOT NULL,
  template_file   TEXT        NOT NULL,   -- 上传的 Word 模板存储路径
  output_file     TEXT,                   -- 渲染完成的输出路径
  placeholder_map JSONB,                  -- { "{{2025_专利总数}}": { value, assetId } }
  render_status   TEXT        NOT NULL DEFAULT 'PENDING',
  render_error    TEXT,
  task_id         TEXT        REFERENCES tasks(id),
  created_by_id   TEXT        NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN documents.placeholder_map IS '占位符解析快照，记录渲染时每个占位符取值来源，供审计追溯';

-- ────────────────────────────────────────────
-- 9. audit_logs — 审计日志表（只追加，不修改）
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id                  TEXT          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT          NOT NULL REFERENCES users(id),
  action              "AuditAction" NOT NULL,
  resource_type       TEXT,          -- 'Task' | 'Asset' | 'User' | 'Department' ...
  resource_id         TEXT,
  metadata            JSONB,         -- 额外上下文：查询词、导出字段、变更 diff 等
  ip_address          TEXT,
  user_agent          TEXT,
  is_dangerous        BOOLEAN        NOT NULL DEFAULT FALSE,
  feishu_verify_token TEXT,          -- 高危操作的飞书二次验证 token
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 只追加，拒绝 UPDATE/DELETE（Row Security）
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS audit_logs_insert_only
  ON audit_logs FOR INSERT WITH CHECK (TRUE);
-- 应用层只授予 INSERT 权限，撤回 UPDATE/DELETE

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

COMMENT ON TABLE audit_logs IS '审计日志：界面无水印，底层全量记录，只追加不修改，满足等保三级要求';
COMMENT ON COLUMN audit_logs.is_dangerous IS '高危操作标志：true 时需飞书二次验证或 VP 审批';

-- ────────────────────────────────────────────
-- 自动更新 updated_at 的触发器
-- ────────────────���───────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['departments','users','task_templates','tasks','task_assignments','assets','documents']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
       CREATE TRIGGER trg_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      tbl, tbl
    );
  END LOOP;
END $$;
