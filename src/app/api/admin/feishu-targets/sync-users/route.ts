/**
 * POST /api/admin/feishu-targets/sync-users
 *
 * 从飞书多维表格同步联系人（Deep Sync 版本，N-to-M 群关系）：
 *   - 「联系人」列（飞书原生【人员】类型）→ 存为 USER
 *   - 「群聊」列（oc_ 开头的 ID）→ 存为 GROUP，并穿透抓取群内所有成员
 *
 * ⚠️  修复了单值 sourceGroupId 被覆盖的 Bug：
 *     先将每一行里的 [人员 × 群名] 全量收集到内存 Map，
 *     循环结束后统一入库，一个人会携带他所在的所有群名（relatedGroups）。
 *
 * 所需飞书权限：
 *   - bitable:app:readonly（读取多维表格记录）
 *   - im:chat:members:readonly（读取群成员，Deep Sync 必须）
 *
 * 环境变量：
 *   FEISHU_ROSTER_APP_TOKEN  — 多维表格 App Token
 *   FEISHU_ROSTER_TABLE_ID   — 目标 Table ID
 *
 * 仅 SUPER_ADMIN 可调用。
 */

import { NextResponse } from "next/server";
import { feishuRequest, getFeishuChatMembers } from "@/lib/feishu";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

interface FeishuPersonItem {
  id?:      string;
  open_id?: string;
  name?:    string;
  en_name?: string;
}

interface BitableRecord {
  record_id: string;
  fields:    Record<string, unknown>;
}

interface BitableRecordsResponse {
  code: number;
  msg:  string;
  data?: {
    items?:      BitableRecord[];
    page_token?: string;
    has_more?:   boolean;
  };
}

export async function POST() {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "权限不足，仅超级管理员可同步联系人" }, { status: 403 });

  const appToken = process.env.FEISHU_ROSTER_APP_TOKEN;
  const tableId  = process.env.FEISHU_ROSTER_TABLE_ID;

  if (!appToken || !tableId) {
    return NextResponse.json(
      { error: "环境变量 FEISHU_ROSTER_APP_TOKEN 或 FEISHU_ROSTER_TABLE_ID 未配置，请重启服务后重试" },
      { status: 500 },
    );
  }

  // ── 分页拉取所有 records ─────────────────────────────────────
  const allRecords: BitableRecord[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    );
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const json = (await feishuRequest(url.toString(), {}, "tenant")) as unknown as BitableRecordsResponse;

    if (json.code !== 0) {
      return NextResponse.json(
        { error: `飞书 Bitable API 错误 (${json.code}): ${json.msg}` },
        { status: 502 },
      );
    }

    for (const item of json.data?.items ?? []) {
      allRecords.push(item);
    }

    pageToken = (json.data?.has_more && json.data?.page_token) ? json.data.page_token : undefined;
  } while (pageToken);

  // ── 第一步显影：打印第一条 record 的完整 fields 结构 ──────────
  if (allRecords.length > 0) {
    console.log("🔥 飞书原始数据包第一条:", JSON.stringify(allRecords[0]?.fields, null, 2));
  }

  // ── 内存聚合阶段：先收集每个人所属的全部群名 ─────────────────
  // Key = feishuId, Value = { name, enName, groups: Set<groupName> }
  const userMap = new Map<string, { name: string; enName?: string; groups: Set<string> }>();

  // 同时记录直接出现在「联系人」列但没有群关联的裸用户（无群名可收集）
  const bareUsers = new Map<string, string>(); // feishuId → name

  let groupSyncedCount = 0;

  for (const record of allRecords) {
    const fields = record.fields;
    if (!fields) continue;

    // 1. 解析当前行的群聊，upsert GROUP，并收集群名
    const groupItems = Array.isArray(fields["群聊"]) ? (fields["群聊"] as FeishuPersonItem[]) : [];
    const currentGroupNames: string[] = [];

    for (const g of groupItems) {
      const gId   = g.id ?? g.open_id;
      const gName = g.name ?? "未知群聊";
      if (!gId || !gId.startsWith("oc_")) continue;

      await prisma.feishuNotificationTarget.upsert({
        where:  { feishuId: gId },
        update: { name: gName, type: "GROUP" },
        create: { feishuId: gId, name: gName, type: "GROUP" },
      });
      groupSyncedCount++;
      currentGroupNames.push(gName);

      // 深度穿透：抓取群内所有成员，归入本群
      try {
        const members = await getFeishuChatMembers(gId);
        for (const member of members) {
          if (!member.member_id) continue;
          if (!userMap.has(member.member_id)) {
            userMap.set(member.member_id, { name: member.name, groups: new Set() });
          }
          userMap.get(member.member_id)!.groups.add(gName);
        }
      } catch (e) {
        console.error(`[sync-users] 群聊穿透失败 ${gName} (${gId}):`, e);
      }
    }

    // 2. 装甲级双语解析：穷举所有可能的联系人列名
    const rawPersonField =
      fields["联系人"] ??
      fields["姓名"]   ??
      fields["PA专员"] ??
      fields["对接人"] ??
      null;

    const contacts = Array.isArray(rawPersonField) ? (rawPersonField as FeishuPersonItem[]) : [];

    for (const u of contacts) {
      const uId = u.id ?? u.open_id;
      if (!uId) continue;

      // 从飞书人员字段提取双语名
      let realCnName = u.name   ?? "";   // 飞书返回的 name（企业设置英文时是英文，中文时是中文）
      const realEnName = u.en_name ?? "";
      const realEmail  = (u as FeishuPersonItem & { email?: string; enterprise_email?: string }).email
                      ?? (u as FeishuPersonItem & { email?: string; enterprise_email?: string }).enterprise_email
                      ?? "";

      // 如果 name 不含中文但 en_name 不同，说明 name 即是英文——保留原值作英文名
      // 如果 name 含中文，它就是真正的中文名
      if (!realCnName) realCnName = realEnName || "未知联系人";

      console.log("[sync-users] 联系人字段原始数据:", JSON.stringify({
        id: uId, name: realCnName, en_name: realEnName, email: realEmail,
      }));

      const existing = userMap.get(uId);
      if (!existing) {
        userMap.set(uId, { name: realCnName, enName: realEnName || undefined, groups: new Set() });
      } else {
        existing.name   = realCnName;
        existing.enName = realEnName || existing.enName;
      }
      currentGroupNames.forEach(gn => userMap.get(uId)!.groups.add(gn));

      if (currentGroupNames.length === 0) {
        bareUsers.set(uId, realCnName);
      }
    }
  }

  // ── 统一入库：每个 USER 带上完整 relatedGroups 数组 ──────────
  let userSyncedCount = 0;

  for (const [feishuId, data] of userMap.entries()) {
    const relatedGroups = Array.from(data.groups);
    await prisma.feishuNotificationTarget.upsert({
      where:  { feishuId },
      update: { name: data.name, type: "USER", relatedGroups },
      create: { feishuId, name: data.name, type: "USER", relatedGroups },
    });

    // 同步双语名称到 User 表（仅当 User 表中存在匹配的 feishuOpenId 时）
    if (feishuId.startsWith("ou_")) {
      try {
        const existingUser = await prisma.user.findUnique({ where: { feishuOpenId: feishuId } });
        if (existingUser) {
          // 强制入库：name 存中文（有中文就用，否则保留 DB 现有值），englishName 存英文/拼音
          const hasChinese = /[\u4e00-\u9fff]/.test(data.name);
          const updateData: { name?: string; englishName?: string } = {};

          if (hasChinese) {
            // Bitable name 含中文 → 直接写入 name
            updateData.name        = data.name;
            updateData.englishName = data.enName || existingUser.englishName || undefined;
          } else {
            // Bitable name 是英文/拼音 → 写入 englishName，name 保留 DB 现有值（人工录入的中文）
            updateData.englishName = data.name || data.enName || undefined;
          }

          if (Object.keys(updateData).length > 0) {
            await prisma.user.update({ where: { feishuOpenId: feishuId }, data: updateData });
          }
        }
      } catch (e) {
        console.error(`[sync-users] 更新 User 表双语名失败 ${feishuId}:`, e);
      }
    }

    userSyncedCount++;
  }

  return NextResponse.json({
    success: true,
    groups:  groupSyncedCount,
    users:   userSyncedCount,
    count:   groupSyncedCount + userSyncedCount,
  });
}
