/**
 * Reception 主接待人 hostDictId ↔ 显示名称 解析工具（服务端）
 *
 * hostDictId 存储 ReceptionDictionary(category=host) 的单条 ID。
 * 视图层"降维"：只展示一级选项名称（若选了二级则向上追溯）。
 */

import prisma from "@/lib/prisma";

export interface HostDictEntry {
  id:       string;
  value:    string;
  parentId: string | null;
}

/** 从 DB 加载全部 host 字典（含已停用项，确保历史 ID 可解析）*/
export async function loadHostDicts(): Promise<Map<string, HostDictEntry>> {
  const rows = await prisma.receptionDictionary.findMany({
    where:  { category: "host" },
    select: { id: true, value: true, parentId: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * 把单个 hostDictId 解析为「一级名称」字符串（列表视图降维用）。
 * 未找到时返回 null（history 容错）。
 */
export function resolveHostRootName(
  id:    string | null | undefined,
  byId:  Map<string, HostDictEntry>,
): string | null {
  if (!id) return null;
  const entry = byId.get(id);
  if (!entry) return null;
  if (entry.parentId) return byId.get(entry.parentId)?.value ?? entry.value;
  return entry.value;
}

/**
 * 把多个 hostDictId 批量解析为「一级名称」数组（多选场景用）。
 * 未找到的条目会被跳过。
 */
export function resolveHostRootNames(
  ids:  string[],
  byId: Map<string, HostDictEntry>,
): string[] {
  return ids.map(id => resolveHostRootName(id, byId)).filter((n): n is string => n !== null);
}
