/**
 * Reception formats ID ↔ 显示名称 解析工具
 *
 * formats 字段存储 ReceptionDictionary.id 数组。
 * 视图层只展示「一级选项名称」：
 *   - 选了一级 ID → 直接取其 value
 *   - 选了二级 ID → 取其父级 value
 *   - 同父级的多个子项只展示一次父名
 */

import prisma from "@/lib/prisma";

export interface FormatDictEntry {
  id:       string;
  value:    string;
  parentId: string | null;
}

/** 从 DB 加载全部 format 字典（平铺，含已停用项）
 *  注意：必须包含 isActive=false 的记录，确保历史 Reception.formats 中的旧 ID
 *  仍能被正确翻译成名称显示，不因软删除而丢失。
 */
export async function loadFormatDicts(): Promise<Map<string, FormatDictEntry>> {
  const rows = await prisma.receptionDictionary.findMany({
    // 不加 isActive 过滤 —— 历史映射必须能覆盖所有已存在的 ID
    where:  { category: "format" },
    select: { id: true, value: true, parentId: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * 把 ID 数组解析为视图层一级名称数组（去重、保序）。
 * 兼容两种情况：
 *   1. 值为字典 ID → 按 ID 查 dictById，取父级名称（原有逻辑）
 *   2. 值为纯文本（如飞书导入的 "展厅"）→ 直接作为显示名称兜底，不静默丢弃
 */
export function resolveToRootNames(
  formatIds: string[],
  dictById:  Map<string, FormatDictEntry>,
): string[] {
  // 兼容非数组（null / undefined / 旧脏数据）
  if (!Array.isArray(formatIds)) return [];

  const seen   = new Set<string>();
  const result: string[] = [];

  for (const fid of formatIds) {
    if (!fid) continue;
    const entry = dictById.get(fid);
    if (!entry) {
      // 未能按 ID 找到 → 可能是飞书导入的纯文本值，直接用作显示名称（兜底容错）
      if (!seen.has(fid)) {
        seen.add(fid);
        result.push(fid);
      }
      continue;
    }
    const rootName = entry.parentId
      ? (dictById.get(entry.parentId)?.value ?? entry.value)
      : entry.value;
    if (!seen.has(rootName)) {
      seen.add(rootName);
      result.push(rootName);
    }
  }
  return result;
}

/**
 * 把 ID 数组解析为完整信息（供详情抽屉展示已选项标签）
 */
export function resolveToFullEntries(
  formatIds: string[],
  dictById:  Map<string, FormatDictEntry>,
): Array<FormatDictEntry & { parentValue: string | null }> {
  return formatIds.flatMap((fid) => {
    const entry = dictById.get(fid);
    if (!entry) return [];
    const parentValue = entry.parentId ? (dictById.get(entry.parentId)?.value ?? null) : null;
    return [{ ...entry, parentValue }];
  });
}
