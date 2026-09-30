/**
 * 服务端工具：当 Reception.todos（大类分类列表）变化时，
 * 同步 ReceptionTodoTask 表（增删子任务）。
 */

import prisma from "@/lib/prisma";
import { TODO_CATEGORY_TASKS } from "@/lib/receptionTodoConstants";

export async function syncTodoTasks(receptionId: string, newCategories: string[]): Promise<void> {
  // 过滤掉不在字典中的分类（容错：未配置规则的分类跳过，不抛异常）
  const validCategories = newCategories.filter(c => {
    const has = c in TODO_CATEGORY_TASKS;
    if (!has) console.warn(`[syncTodoTasks] Unknown category "${c}" – skipped`);
    return has;
  });

  let existing: { category: string }[] = [];
  try {
    existing = await prisma.receptionTodoTask.findMany({
      where:  { receptionId, deletedAt: null },
      select: { category: true },
    });
  } catch (err) {
    console.error("[syncTodoTasks] findMany failed:", err);
    throw err;
  }

  const existingCats = [...new Set(existing.map(t => t.category))];
  const toAdd    = validCategories.filter(c => !existingCats.includes(c));
  const toRemove = existingCats.filter(c => !validCategories.includes(c));

  if (toAdd.length === 0 && toRemove.length === 0) return;

  console.log(`[syncTodoTasks] reception=${receptionId} add=[${toAdd}] remove=[${toRemove}]`);

  try {
    await prisma.$transaction(async tx => {
      if (toRemove.length > 0) {
        await tx.receptionTodoTask.updateMany({
          where: { receptionId, category: { in: toRemove }, deletedAt: null },
          data:  { deletedAt: new Date() },
        });
      }

      const newTasks = toAdd.flatMap(cat => {
        const templates = TODO_CATEGORY_TASKS[cat];
        if (!templates?.length) return [];
        return templates.map((t, i) => ({
          receptionId,
          category:  cat,
          content:   t.content,
          link:      t.link ?? null,
          sortOrder: i,
        }));
      });

      if (newTasks.length > 0) {
        await tx.receptionTodoTask.createMany({ data: newTasks });
      }
    });
  } catch (err) {
    console.error("[syncTodoTasks] $transaction failed:", err);
    throw err;
  }
}
