import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateResponse } from "@/lib/llm";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.stats) return NextResponse.json({ error: "缺少 stats 参数" }, { status: 400 });

  const { stats } = body as {
    stats: {
      departmentDistribution: Array<{ name: string; count: number }>;
      taskTypeRatio: { SPECIAL: number; PERIODIC: number };
      completionRate: number;
    };
  };

  const topDept = stats.departmentDistribution[0];
  const prompt = `你是政企数据分析助手。根据以下任务统计，用一句话（30字以内中文）给出最关键洞察，可以是风险预警或行动建议，不要在洞察里重复原始数字：
- 部门任务分布：${JSON.stringify(stats.departmentDistribution.slice(0, 5))}（最重负载部门：${topDept?.name ?? "无"}）
- 任务类型：专项 ${stats.taskTypeRatio.SPECIAL} 个，周期 ${stats.taskTypeRatio.PERIODIC} 个
- 全局完成率：${stats.completionRate.toFixed(1)}%
直接输出洞察句子，不要任何前缀或标点以外的格式。`;

  try {
    const insight = await generateResponse(prompt);
    return NextResponse.json({ insight: insight.trim().slice(0, 100) });
  } catch {
    return NextResponse.json({ insight: "AI 服务暂时不可用，请稍后刷新" });
  }
}
