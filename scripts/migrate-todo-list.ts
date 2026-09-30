/**
 * scripts/migrate-todo-list.ts
 *
 * 将旧版 Reception.todos + ReceptionTodoTask 迁移到新的
 * Reception.todoList (TodoCategory[]) JSON 字段。
 * 幂等：已有 todoList 的记录跳过。
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })) } as any);

function uuid() {
  return Math.random().toString(36).slice(2, 11) + "-" + Date.now().toString(36);
}

async function main() {
  const recs = await prisma.reception.findMany({
    where:  { deletedAt: null },
    select: { id: true, todos: true, todoList: true },
  });

  let migrated = 0, skipped = 0;

  for (const rec of recs) {
    const existing = rec.todoList as unknown[];
    if (Array.isArray(existing) && existing.length > 0) { skipped++; continue; }

    const oldTodos = Array.isArray(rec.todos) ? (rec.todos as string[]) : [];
    if (oldTodos.length === 0) { skipped++; continue; }

    // 加载旧任务表
    const oldTasks = await prisma.receptionTodoTask.findMany({
      where:   { receptionId: rec.id, deletedAt: null },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });

    const todoList = oldTodos.map(title => ({
      id:    uuid(),
      title,
      tasks: oldTasks
        .filter(t => t.category === title)
        .map(t => ({
          id:          uuid(),
          content:     t.content,
          isCompleted: t.isCompleted,
          ...(t.actionType && t.actionValue
            ? { link: { type: t.actionType.toLowerCase() as "url" | "feishu_doc" | "feishu_chat", target: t.actionValue } }
            : t.link
            ? { link: { type: "url" as const, target: t.link } }
            : {}),
        })),
    }));

    await prisma.reception.update({
      where: { id: rec.id },
      data:  { todoList },
    });
    console.log(`  [OK] ${rec.id.slice(0, 8)}… → ${todoList.length} 分类，${oldTasks.length} 任务`);
    migrated++;
  }

  console.log(`\n迁移完成：${migrated} 条，跳过 ${skipped} 条`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
