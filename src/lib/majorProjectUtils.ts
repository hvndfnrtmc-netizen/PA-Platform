/**
 * 重大项目共享工具函数
 */

/**
 * 从项目名称中提取四位年份（匹配 20xx）。
 * 例如 "Xheart-2026年苏州市重点项目" → 2026
 * 没有年份时返回 null。
 */
export function extractYearFromName(name: string): number | null {
  if (!name) return null;
  const match = name.match(/(20\d{2})/);
  return match ? parseInt(match[1], 10) : null;
}
