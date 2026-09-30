/**
 * POST /api/reception/migrate-formats
 * 一次性迁移：把 Reception.formats string[] (名称) 转换为 ReceptionDictionary ID[]
 * 仅 SUPER_ADMIN 可调用。迁移完成后此端点可保留（幂等，重复执行安全）。
 *
 * 逻辑：
 *  1. 找出所有 formats 不为空的 Reception 记录
 *  2. 把每个 format 字符串在 dict(category=format) 里查 ID，找不到则创建
 *  3. 用 ID 数组替换原 formats，批量更新
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  void req;
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可执行迁移" }, { status: 403 });

  // 1. 加载所有 format 字典（一级，parentId=null）
  const existingDicts = await prisma.receptionDictionary.findMany({
    where: { category: "format", parentId: null },
  });
  // name → id 的映射缓存
  const nameToId = new Map(existingDicts.map((d) => [d.value, d.id]));

  // 2. 加载所有 formats 不为空的记录
  const receptions = await prisma.reception.findMany({
    select: { id: true, formats: true },
  });

  let migratedCount   = 0;
  let alreadyMigrated = 0;
  let createdDicts    = 0;

  for (const rec of receptions) {
    const formats = rec.formats as unknown as string[];
    if (!Array.isArray(formats) || formats.length === 0) continue;

    // 判断是否已经是 ID（cuid 格式：以 c 开头，长度约 25）
    const isAlreadyId = (v: string) => /^c[a-z0-9]{24,}$/i.test(v);
    if (formats.every(isAlreadyId)) {
      alreadyMigrated++;
      continue;
    }

    // 把名称转为 ID（找不到则创建）
    const ids: string[] = [];
    for (const name of formats) {
      if (isAlreadyId(name)) {
        // 混合状态：部分已是 ID，保留
        ids.push(name);
        continue;
      }
      let id = nameToId.get(name);
      if (!id) {
        // 在字典里创建这个选项
        const found = await prisma.receptionDictionary.findFirst({
          where: { category: "format", value: name, parentId: null },
        });
        const created = found ?? await prisma.receptionDictionary.create({
          data: { category: "format", value: name, parentId: null, isDefault: false },
        });
        id = created.id;
        nameToId.set(name, id);
        createdDicts++;
      }
      ids.push(id);
    }

    await prisma.reception.update({
      where: { id: rec.id },
      data:  { formats: ids },
    });
    migratedCount++;
  }

  return NextResponse.json({
    ok:             true,
    migratedCount,
    alreadyMigrated,
    createdDicts,
    message: `迁移完成：${migratedCount} 条记录已更新，${alreadyMigrated} 条已是 ID 格式，新建字典项 ${createdDicts} 个`,
  });
}
