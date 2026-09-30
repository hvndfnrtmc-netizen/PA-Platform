"use server";

import prisma from "@/lib/prisma";

/**
 * 擦除测试期间写入的假中文名，将其恢复为真实英文名
 * 针对 name 在 ['张三', '李四', '王五', '赵六', '钱七'] 中的用户
 */
export async function cleanMockChineseNames() {
  const MOCK_NAMES = ["张三", "李四", "王五", "赵六", "钱七"];
  try {
    const polluted = await prisma.user.findMany({
      where: { name: { in: MOCK_NAMES } },
      select: { id: true, name: true, englishName: true, email: true },
    });

    let cleaned = 0;
    for (const u of polluted) {
      // 优先用 englishName，其次取 email 前缀
      const realName = u.englishName?.trim() || u.email?.split("@")[0] || u.name;
      await prisma.user.update({
        where: { id: u.id },
        data:  { name: realName },
      });
      cleaned++;
    }

    return { success: true, cleaned };
  } catch (e) {
    console.error("[cleanMockChineseNames]", e);
    return { success: false, error: (e as Error).message };
  }
}
