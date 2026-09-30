/**
 * POST /api/admin/sync-feishu-users
 *
 * 从飞书通讯录全量拉取真实员工并 upsert 到 User 表。
 * 流程：
 *   1. 获取飞书全部部门（含分页，BFS 递归）
 *   2. 逐部门拉取用户（含分页），以 open_id 去重
 *   3. 清理 @momenta.mock 假人
 *   4. Upsert 真实用户（feishuOpenId → email 双重容错）
 *
 * 仅 SUPER_ADMIN 可调用。
 */

import { NextResponse }         from "next/server";
import prisma                   from "@/lib/prisma";
import { getTenantAccessToken } from "@/lib/feishu";
import { getSession }           from "@/lib/auth";
import { UserRole }             from "@prisma/client";

const FEISHU = "https://open.feishu.cn/open-apis";

// ── 类型 ────────────────────────────────────────────────────────────

interface FeishuRawUser {
  open_id:           string;
  name:              string;        // 飞书中文名
  en_name?:          string;        // 英文名
  email?:            string;
  enterprise_email?: string;
  avatar?:           { avatar_origin?: string };
  status?:           { is_activated?: boolean };
}

// ── 飞书 API 工具 ────────────────────────────────────────────────────

/** 拉取某个部门的直属子部门 ID 列表（含分页） */
async function fetchChildDeptIds(token: string, parentId: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${FEISHU}/contact/v3/departments`);
    url.searchParams.set("parent_department_id", parentId);
    url.searchParams.set("user_id_type",         "open_id");
    url.searchParams.set("department_id_type",   "department_id");
    url.searchParams.set("page_size",            "50");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res  = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache:   "no-store",
    });
    const json = await res.json() as {
      code: number;
      data?: { items?: { department_id?: string }[]; page_token?: string };
    };
    if (json.code !== 0) break;

    for (const dept of json.data?.items ?? []) {
      if (dept.department_id) ids.push(dept.department_id);
    }
    pageToken = json.data?.page_token;
  } while (pageToken);
  return ids;
}

/** BFS 遍历飞书部门树，返回所有部门 ID（含根 "0"） */
async function fetchAllDeptIds(token: string): Promise<string[]> {
  const all: string[]    = ["0"];
  const queue: string[]  = ["0"];
  const visited          = new Set<string>(["0"]);

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await fetchChildDeptIds(token, parentId);
    for (const id of children) {
      if (!visited.has(id)) {
        visited.add(id);
        all.push(id);
        queue.push(id);
      }
    }
  }
  return all;
}

/** 拉取某个部门的直属用户列表（含分页） */
async function fetchUsersInDept(token: string, deptId: string): Promise<FeishuRawUser[]> {
  const users: FeishuRawUser[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${FEISHU}/contact/v3/users/find_by_department`);
    url.searchParams.set("department_id",      deptId);
    url.searchParams.set("user_id_type",       "open_id");
    url.searchParams.set("department_id_type", "department_id");
    url.searchParams.set("page_size",          "50");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res  = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache:   "no-store",
    });
    const json = await res.json() as {
      code: number;
      data?: { items?: FeishuRawUser[]; page_token?: string };
    };
    if (json.code !== 0) break;

    users.push(...(json.data?.items ?? []));
    pageToken = json.data?.page_token;
  } while (pageToken);
  return users;
}

// ── 主路由 ───────────────────────────────────────────────────────────

export async function POST() {
  // 鉴权
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可操作" }, { status: 403 });

  // 环境变量检查
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET)
    return NextResponse.json(
      { error: "未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，请先在 Vercel 环境变量中设置" },
      { status: 400 },
    );

  try {
    // ── 1. 获取 Token ──────────────────────────────────────────────
    const token = await getTenantAccessToken();

    // ── 2. 遍历全量部门，收集用户（以 open_id 去重） ──────────────
    const deptIds = await fetchAllDeptIds(token);
    const userMap = new Map<string, FeishuRawUser>();

    for (const deptId of deptIds) {
      const raw = await fetchUsersInDept(token, deptId);
      for (const u of raw) {
        if (u.open_id && u.name) {
          userMap.set(u.open_id, u);
        }
      }
    }

    const realUsers = Array.from(userMap.values());

    // ── 3. 清理 @momenta.mock 假数据 ──────────────────────────────
    const cleaned = await prisma.user.deleteMany({
      where: { email: { endsWith: "@momenta.mock" } },
    });

    // ── 4. Upsert 真实用户 ────────────────────────────────────────
    let synced  = 0;
    let skipped = 0;

    for (const u of realUsers) {
      const realEmail = u.enterprise_email?.trim() || u.email?.trim() || "";
      const email     = realEmail || `${u.open_id}@feishu.local`;
      const avatarUrl = u.avatar?.avatar_origin ?? null;

      try {
        // 优先以 feishuOpenId 为唯一键
        await prisma.user.upsert({
          where:  { feishuOpenId: u.open_id },
          update: {
            name:     u.name,   // 始终更新为飞书中文名
            email,
            avatarUrl,
            isActive: true,
          },
          create: {
            feishuOpenId: u.open_id,
            name:         u.name,
            email,
            avatarUrl,
            role:     UserRole.DEPT_CONTACT,
            isActive: true,
          },
        });
        synced++;
      } catch {
        // feishuOpenId 冲突或 email 唯一冲突时，退而以 email 更新
        if (realEmail) {
          try {
            await prisma.user.upsert({
              where:  { email: realEmail },
              update: {
                name:         u.name,
                feishuOpenId: u.open_id,
                avatarUrl,
                isActive:     true,
              },
              create: {
                feishuOpenId: u.open_id,
                name:         u.name,
                email:        realEmail,
                avatarUrl,
                role:         UserRole.DEPT_CONTACT,
                isActive:     true,
              },
            });
            synced++;
          } catch {
            skipped++;
          }
        } else {
          skipped++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      cleaned: cleaned.count,
      total:   realUsers.length,
      depts:   deptIds.length,
    });
  } catch (e) {
    console.error("[sync-feishu-users]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
