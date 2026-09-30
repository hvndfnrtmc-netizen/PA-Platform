"use server";

/**
 * ODC 政企网络 — Server Actions
 * 机构增删改查、对接人获取
 */

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

// ── 获取后台人员（对接人下拉数据源） ──────────────────────────────
export async function getAdminUsers() {
  const session = await getSession();
  if (!session?.user) return [];

  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  return users;
}

// ── 获取全部机构（用于初始加载） ──────────────────────────────────
export async function getOdcInstitutions() {
  try {
    const list = await prisma.odcInstitution.findMany({
      orderBy: { createdAt: "asc" },
    });
    return list;
  } catch (e) {
    console.error("[getOdcInstitutions]", e);
    return [];
  }
}

// ── 创建机构 ──────────────────────────────────────────────────────
export async function createOdcInstitution(data: {
  shortName: string;
  fullName: string;
  jurisdiction: string;
  verticalLine: string;
  level: string;
  divisions?: { name: string; assigneeName?: string; assigneeFeishuId?: string }[];
}) {
  try {
    const result = await prisma.odcInstitution.create({
      data: {
        shortName:    data.shortName,
        fullName:     data.fullName,
        jurisdiction: data.jurisdiction,
        verticalLine: data.verticalLine,
        level:        data.level,
        divisions:    (data.divisions ?? []) as object[],
      },
    });
    revalidatePath("/dashboard/odc");
    return { success: true, id: result.id };
  } catch (e) {
    console.error("[createOdcInstitution]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 更新/Upsert 机构（兼容静态节点）──────────────────────────────
// 如果 id 对应的记录不存在（如静态节点），则 upsert 创建一条
export async function upsertOdcInstitution(
  id: string,
  data: {
    shortName?: string;
    fullName?: string;
    jurisdiction?: string;
    verticalLine?: string;
    level?: string;
    divisions?: { name: string; assigneeName?: string; assigneeFeishuId?: string }[];
  }
) {
  try {
    await prisma.odcInstitution.upsert({
      where: { id },
      update: {
        ...(data.shortName    !== undefined && { shortName:    data.shortName }),
        ...(data.fullName     !== undefined && { fullName:     data.fullName }),
        ...(data.jurisdiction !== undefined && { jurisdiction: data.jurisdiction }),
        ...(data.verticalLine !== undefined && { verticalLine: data.verticalLine }),
        ...(data.level        !== undefined && { level:        data.level }),
        ...(data.divisions    !== undefined && { divisions:    data.divisions as object[] }),
      },
      create: {
        id,
        shortName:    data.shortName    ?? "",
        fullName:     data.fullName     ?? "",
        jurisdiction: data.jurisdiction ?? "",
        verticalLine: data.verticalLine ?? "",
        level:        data.level        ?? "",
        divisions:    (data.divisions   ?? []) as object[],
      },
    });
    revalidatePath("/dashboard/odc");
    return { success: true };
  } catch (e) {
    console.error("[upsertOdcInstitution]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 删除机构 ──────────────────────────────────────────────────────
// 先级联清理关联子表，避免 FK 约束报错
export async function deleteOdcInstitution(id: string) {
  try {
    await prisma.odcSubDepartment.deleteMany({ where: { institutionId: id } });
    await prisma.odcLeader.deleteMany({ where: { institutionId: id } });
    await prisma.institutionIntelligence.deleteMany({ where: { institutionId: id } });
    await prisma.odcInstitution.deleteMany({ where: { id } });
    revalidatePath("/dashboard/odc");
    return { success: true };
  } catch (e) {
    console.error("[deleteOdcInstitution]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 更新机构官网 URL ──────────────────────────────────────────────
export async function updateInstitutionWebsite(institutionId: string, websiteUrl: string) {
  try {
    await prisma.odcInstitution.upsert({
      where: { id: institutionId },
      update: { websiteUrl },
      create: {
        id:           institutionId,
        shortName:    "",
        fullName:     "",
        jurisdiction: "",
        verticalLine: "",
        level:        "",
        divisions:    [],
        websiteUrl,
      },
    });
    return { success: true };
  } catch (e) {
    console.error("[updateInstitutionWebsite]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 下设科室 CRUD ─────────────────────────────────────────────────

export async function getSubDepartments(institutionId: string) {
  try {
    return await prisma.odcSubDepartment.findMany({
      where: { institutionId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  } catch (e) {
    console.error("[getSubDepartments]", e);
    return [];
  }
}

export async function createSubDepartment(data: {
  institutionId: string;
  name: string;
  responsibilities?: string;
  contactPersonId?: string;
  externalContactName?: string;
  parentId?: string;
}) {
  try {
    const result = await prisma.odcSubDepartment.create({ data });
    return { success: true, id: result.id };
  } catch (e) {
    console.error("[createSubDepartment]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function updateSubDepartment(id: string, data: {
  name?: string;
  responsibilities?: string;
  contactPersonId?: string | null;
  externalContactName?: string | null;
}) {
  try {
    await prisma.odcSubDepartment.update({ where: { id }, data });
    return { success: true };
  } catch (e) {
    console.error("[updateSubDepartment]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function deleteSubDepartment(id: string) {
  try {
    // 先删除所有子节点
    await prisma.odcSubDepartment.deleteMany({ where: { parentId: id } });
    await prisma.odcSubDepartment.delete({ where: { id } });
    return { success: true };
  } catch (e) {
    console.error("[deleteSubDepartment]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 领导班子 CRUD ─────────────────────────────────────────────────

export async function getLeaders(institutionId: string) {
  try {
    return await prisma.odcLeader.findMany({
      where: { institutionId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  } catch (e) {
    console.error("[getLeaders]", e);
    return [];
  }
}

export async function createLeader(data: {
  institutionId: string;
  name: string;
  title: string;
  bio?: string;
  profileUrl?: string;
  avatarUrl?: string;
}) {
  try {
    const result = await prisma.odcLeader.create({ data });
    return { success: true, id: result.id };
  } catch (e) {
    console.error("[createLeader]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function updateLeader(id: string, data: {
  name?: string;
  title?: string;
  bio?: string;
  profileUrl?: string;
  avatarUrl?: string | null;
}) {
  try {
    await prisma.odcLeader.update({ where: { id }, data });
    return { success: true };
  } catch (e) {
    console.error("[updateLeader]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function deleteLeader(id: string) {
  try {
    await prisma.odcLeader.delete({ where: { id } });
    return { success: true };
  } catch (e) {
    console.error("[deleteLeader]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 真实 Firecrawl 爬取 + 反幻觉结构化提取 ───────────────────────
export async function seedMockInstitutionData(institutionId: string, institutionName: string) {
  const abpBaseUrl   = process.env.ABP_BASE_URL ?? process.env.ABP_LLM_BASE_URL ?? "";
  const abpApiKey    = process.env.ABP_API_KEY  ?? process.env.ABP_LLM_API_KEY  ?? "";
  const abpModel     = process.env.ABP_MODEL_NAME ?? "gpt-4o";
  const firecrawlKey = process.env.FIRECRAWL_API_KEY ?? "";

  type AiResult = {
    subDepartments: { name: string; responsibilities: string }[];
    leaders: { name: string; title: string }[];
  };

  try {
    // ── Step 1：确保官网 URL 存在（不存在则用大模型自动发现）─────────
    const instRecord = await prisma.odcInstitution.findUnique({
      where: { id: institutionId },
      select: { websiteUrl: true },
    });
    let targetUrl: string = instRecord?.websiteUrl ?? "";

    if (!targetUrl) {
      if (!abpBaseUrl || !abpApiKey) {
        throw new Error("未配置 ABP_BASE_URL / ABP_API_KEY，且机构官网未录入，无法自动发现网址。请先手动录入官网。");
      }
      // 用大模型获取官方网址（大模型对政府官网记忆极其准确）
      const urlResp = await fetch(`${abpBaseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${abpApiKey}` },
        body: JSON.stringify({
          model: abpModel,
          messages: [
            { role: "system", content: "你是一个知道政府机构官网网址的助手。只返回纯粹的网址字符串，不要任何解释或多余文字。" },
            { role: "user",   content: `请告诉我【${institutionName}】的官方网站主页URL，只返回一个纯粹的网址字符串，不要任何多余文字。` },
          ],
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!urlResp.ok) throw new Error(`大模型网址发现失败: HTTP ${urlResp.status}`);
      const urlJson = await urlResp.json() as { choices?: { message?: { content?: string } }[] };
      const discoveredUrl = (urlJson?.choices?.[0]?.message?.content ?? "").trim().replace(/["""']/g, "");
      if (!discoveredUrl.startsWith("http")) throw new Error(`大模型返回了无效网址：${discoveredUrl}`);
      targetUrl = discoveredUrl;
      // 持久化到数据库
      await prisma.odcInstitution.update({ where: { id: institutionId }, data: { websiteUrl: targetUrl } }).catch(() => {});
      console.log(`[AI抓取] 自动发现官网: ${targetUrl}`);
    }

    // ── Step 2：Firecrawl 深度剥离 + 原生 JSON 结构化提取（合并原 ABP 调用）──
    if (!firecrawlKey) {
      throw new Error("未配置 FIRECRAWL_API_KEY，无法进行真实爬取。请联系管理员配置。");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = await import("@mendable/firecrawl-js") as any;
    const FirecrawlCtor = fc.Firecrawl ?? fc.default;
    const fcApp = new FirecrawlCtor({ apiKey: firecrawlKey }) as {
      scrape: (url: string, opts: Record<string, unknown>) => Promise<{ markdown?: string; json?: unknown }>;
    };
    const scrapeResult = await fcApp.scrape(targetUrl, {
      formats: [
        "markdown",
        {
          type: "json" as const,
          prompt:
            `你是一个政府架构情报分析师。目标机构是：【${institutionName}】。` +
            "从网页中提取下设科室(subDepartments)和领导班子(leaders)。" +
            "注意：政府网站导航栏通常含「机构设置」「内设机构」「领导之窗」等菜单项，请从这些入口推断处室。" +
            "【绝对禁止编造虚假人名（如张三、李四、王建国等）】！实在找不到则返回空数组。",
          schema: {
            type: "object",
            properties: {
              subDepartments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name:             { type: "string", description: "科室/处室名称" },
                    responsibilities: { type: "string", description: "主要职责描述" },
                  },
                  required: ["name"],
                },
              },
              leaders: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name:  { type: "string", description: "领导姓名（禁止编造）" },
                    title: { type: "string", description: "职务名称" },
                  },
                  required: ["name", "title"],
                },
              },
            },
          },
        },
      ],
      onlyMainContent: false,  // 获取完整页面（含导航栏/底部链接）以发现处室入口
    });

    if (!scrapeResult.markdown && !scrapeResult.json) {
      throw new Error(`Firecrawl 爬取 ${targetUrl} 返回内容为空，请确认该 URL 可访问。`);
    }
    console.log(`[AI抓取] Firecrawl 爬取完成，获取 ${(scrapeResult.markdown ?? "").length} 字符 Markdown + JSON 结构化提取`);

    const aiResult: AiResult = (scrapeResult.json as AiResult | null) ?? { subDepartments: [], leaders: [] };

    // ── Step 4：清空旧数据（彻底抹除幻觉假数据），写入真实数据 ────
    await prisma.odcSubDepartment.deleteMany({ where: { institutionId } });
    await prisma.odcLeader.deleteMany({ where: { institutionId } });

    await Promise.all(
      (aiResult.subDepartments ?? []).map((d, i) =>
        prisma.odcSubDepartment.create({
          data: { institutionId, name: d.name, responsibilities: d.responsibilities, sortOrder: i },
        })
      )
    );
    await Promise.all(
      (aiResult.leaders ?? []).map((l, i) =>
        prisma.odcLeader.create({
          data: { institutionId, name: l.name, title: l.title, sortOrder: i },
        })
      )
    );

    revalidatePath("/dashboard/odc");
    return { success: true };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[seedMockInstitutionData]", e);
    return { success: false, error: `AI抓取失败: ${msg}。这通常是因为该政府网站开启了强力反爬虫拦截，导致 Firecrawl 无法读取 HTML。` };
  }
}

// ── 业务条线 CRUD ────────────────────────────────────────────────

export async function getOdcLines() {
  try {
    const lines = await prisma.odcBusinessLine.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    // 确保"其他条线"永远排最后
    return lines.sort((a, b) => {
      if (a.name === "其他条线") return 1;
      if (b.name === "其他条线") return -1;
      return a.sortOrder - b.sortOrder;
    });
  } catch (e) {
    console.error("[getOdcLines]", e);
    return [];
  }
}

export async function createOdcLine(name: string) {
  try {
    const existing = await prisma.odcBusinessLine.findMany({ orderBy: { sortOrder: "asc" } });
    const maxOrder = existing.reduce((max, l) => Math.max(max, l.sortOrder), 0);
    const result = await prisma.odcBusinessLine.create({
      data: { name: name.trim(), sortOrder: maxOrder + 1 },
    });
    revalidatePath("/dashboard/odc");
    return { success: true, id: result.id };
  } catch (e) {
    console.error("[createOdcLine]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function updateOdcLine(id: string, name: string) {
  try {
    await prisma.odcBusinessLine.update({ where: { id }, data: { name: name.trim() } });
    revalidatePath("/dashboard/odc");
    return { success: true };
  } catch (e) {
    console.error("[updateOdcLine]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function deleteOdcLine(id: string) {
  try {
    // 不允许删除"其他条线"
    const line = await prisma.odcBusinessLine.findUnique({ where: { id } });
    if (line?.name === "其他条线") return { success: false, error: "「其他条线」不可删除" };
    await prisma.odcBusinessLine.delete({ where: { id } });
    revalidatePath("/dashboard/odc");
    return { success: true };
  } catch (e) {
    console.error("[deleteOdcLine]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function seedDefaultOdcLines() {
  // 预置默认条线（仅在表为空时执行）
  const existing = await prisma.odcBusinessLine.count();
  if (existing > 0) return { success: true, seeded: false };

  const defaults = [
    "工信条线", "发改条线", "商务条线", "科技条线",
    "人社条线", "人民政府", "市场监管", "民政条线",
    "组织人事", "企业服务", "投资促进", "其他条线",
  ];
  await prisma.odcBusinessLine.createMany({
    data: defaults.map((name, i) => ({ name, sortOrder: i })),
    skipDuplicates: true,
  });
  return { success: true, seeded: true };
}

// ── 任务七：AI 情报研判管线 ────────────────────────────────────────

export async function getInstitutionIntelligence(institutionId: string) {
  try {
    return await prisma.institutionIntelligence.findUnique({
      where: { institutionId },
    });
  } catch (e) {
    console.error("[getInstitutionIntelligence]", e);
    return null;
  }
}

export async function generateInstitutionIntelligence(
  institutionId: string,
  institutionName: string,
) {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY ?? "";

  type NewsItem = { title: string; date: string; url: string };
  type AiResult = { summary: string; businessAnalysis: string; news: NewsItem[] };

  try {
    if (!firecrawlKey) throw new Error("未配置 FIRECRAWL_API_KEY，无法进行全网检索。");

    // ① 计算近一个月时间范围（时间锁基准）
    const today       = new Date();
    const oneMonthAgo = new Date(new Date().setMonth(today.getMonth() - 1));
    const todayStr    = today.toISOString().split("T")[0];
    const monthAgoStr = oneMonthAgo.toISOString().split("T")[0];
    const dateString  = `${monthAgoStr} 至 ${todayStr}`;

    // ② Firecrawl Agent 一站式搜索 + 时间锁 AI 分析（替代原 search + ABP 双管线）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = await import("@mendable/firecrawl-js") as any;
    const FirecrawlCtor = fc.Firecrawl ?? fc.default;
    const fcApp = new FirecrawlCtor({ apiKey: firecrawlKey }) as {
      agent: (opts: Record<string, unknown>) => Promise<{ status: string; data?: unknown }>;
    };

    const agentResult = await fcApp.agent({
      prompt:
        `今天的日期是 ${todayStr}。请搜索"${institutionName}"的最新工作动态和新闻。\n` +
        `【时间锁最高指令】：严格过滤，只提取发生时间在【近一个月内（${dateString}）】的真实新闻！` +
        `任何早于 ${monthAgoStr} 的新闻，或没有明确时间的，直接丢弃，宁可返回空数组也绝对不许编造！\n` +
        `请以 JSON 格式返回（直接输出 JSON，不要代码块或额外文字）：\n` +
        `{"news":[{"title":"真实新闻标题","date":"YYYY-MM-DD","url":"来源链接，无则空字符串"}],` +
        `"summary":"根据上述新闻总结近一个月的核心政策（如无则写：近一个月内未在互联网上监测到该机构的重大公开动态）",` +
        `"businessAnalysis":"结合Momenta自动驾驶业务，分析上述动态可能带来的合作机会"}`,
      model: "spark-1-pro",
      schema: {
        type: "object",
        properties: {
          news: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                date:  { type: "string", description: "YYYY-MM-DD 格式，必须在近一个月内" },
                url:   { type: "string" },
              },
              required: ["title", "date", "url"],
            },
          },
          summary:          { type: "string" },
          businessAnalysis: { type: "string" },
        },
      },
    });

    console.log(`[情报扫描] Firecrawl Agent 分析完成，status: ${agentResult.status}`);

    // ③ 解析 Agent 返回数据（支持结构化对象和纯文本两种返回形式）
    let aiResult: AiResult;
    const rawData = agentResult.data;
    if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
      aiResult = rawData as AiResult;
    } else {
      const rawContent = typeof rawData === "string" ? rawData : JSON.stringify(rawData ?? "{}");
      const jsonString = rawContent.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
      try {
        aiResult = JSON.parse(jsonString) as AiResult;
      } catch {
        throw new Error(`Agent 返回内容无法解析为 JSON：${rawContent.slice(0, 300)}`);
      }
    }

    // 兜底：news 为空时给 summary 赋默认值
    if (!aiResult.news || aiResult.news.length === 0) {
      aiResult.summary = "近一个月内未在互联网上监测到该机构的重大公开动态。";
    }

    // ④ 持久化（兼容旧 aiAnalysis 字段结构）
    const aiAnalysis = {
      summary:     aiResult.summary        ?? "",
      impact:      aiResult.businessAnalysis ?? "",
      suggestions: "",
    };
    const saved = await prisma.institutionIntelligence.upsert({
      where:  { institutionId },
      update: { rawNewsData: aiResult.news ?? [], aiAnalysis, lastScrapedAt: new Date() },
      create: { institutionId, rawNewsData: aiResult.news ?? [], aiAnalysis },
    });

    revalidatePath("/dashboard/odc");
    return { success: true, data: saved };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[generateInstitutionIntelligence]", e);
    return { success: false, error: `AI情报扫描失败: ${msg}。这通常是因为该政府网站开启了强力反爬虫拦截，导致 Firecrawl 无法读取 HTML。` };
  }
}

// ── 任务八：历史接待跨模块关联 ────────────────────────────────────

export async function getAvailableReceptions(keyword?: string) {
  try {
    const receptions = await prisma.reception.findMany({
      where: {
        deletedAt: null,
        ...(keyword ? {
          OR: [
            { title:   { contains: keyword, mode: "insensitive" } },
            { purpose: { contains: keyword, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: { id: true, title: true, startTime: true, level: true, purpose: true },
      orderBy: { startTime: "desc" },
      take: 50,
    });
    return receptions;
  } catch (e) {
    console.error("[getAvailableReceptions]", e);
    return [];
  }
}

export async function linkReceptionsToInstitution(
  institutionId: string,
  receptionIds: string[],
) {
  try {
    // 追加（不覆盖）已有关联
    const existing = await prisma.odcInstitution.findUnique({
      where:  { id: institutionId },
      select: { linkedReceptionIds: true },
    });
    const merged = Array.from(new Set([...(existing?.linkedReceptionIds ?? []), ...receptionIds]));
    await prisma.odcInstitution.upsert({
      where:  { id: institutionId },
      update: { linkedReceptionIds: merged },
      create: {
        id:                 institutionId,
        shortName:          "",
        fullName:           "",
        jurisdiction:       "",
        verticalLine:       "",
        level:              "",
        divisions:          [],
        linkedReceptionIds: merged,
      },
    });
    revalidatePath("/dashboard/odc");
    return { success: true };
  } catch (e) {
    console.error("[linkReceptionsToInstitution]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function getLinkedReceptionsDetails(institutionId: string) {
  try {
    const inst = await prisma.odcInstitution.findUnique({
      where:  { id: institutionId },
      select: { linkedReceptionIds: true },
    });
    if (!inst || inst.linkedReceptionIds.length === 0) return [];
    const receptions = await prisma.reception.findMany({
      where:   { id: { in: inst.linkedReceptionIds }, deletedAt: null },
      select:  { id: true, title: true, startTime: true, level: true, purpose: true },
      orderBy: { startTime: "desc" },
    });
    return receptions;
  } catch (e) {
    console.error("[getLinkedReceptionsDetails]", e);
    return [];
  }
}

// ── 一键注入全量 48 条机构台账 ────────────────────────────────────
const INITIAL_ODC_DATA = [
  { name: "江苏省委/江苏省人民政府", shortName: "省委/省政府", region: "江苏省", line: "人民政府", level: "省级", contactName: "Yuting Wang" },
  { name: "江苏省工业和信息化厅", shortName: "工信厅", region: "江苏省", line: "工信条线", level: "省级", contactName: "Yuting Wang" },
  { name: "江苏省商务厅", shortName: "商务厅", region: "江苏省", line: "商务条线", level: "省级", contactName: "Yuting Wang" },
  { name: "江苏省发展和改革委员会", shortName: "发改委", region: "江苏省", line: "发改条线", level: "省级", contactName: "Yuting Wang" },
  { name: "江苏省科学技术厅", shortName: "科技厅", region: "江苏省", line: "科技条线", level: "省级", contactName: "Yuting Wang" },
  { name: "苏州市委/苏州市人民政府", shortName: "市委/市政府", region: "江苏省", line: "人民政府", level: "市级", contactName: "Yuting Wang" },
  { name: "苏州市工业和信息化局", shortName: "工信局", region: "江苏省", line: "工信条线", level: "市级", contactName: "Yuting Wang, Zoe Gu" },
  { name: "苏州市科学技术局", shortName: "科技局", region: "江苏省", line: "科技条线", level: "市级", contactName: "Yuting Wang, Zoe Gu" },
  { name: "苏州市发展和改革委员会", shortName: "发改委", region: "江苏省", line: "发改条线", level: "市级", contactName: "Yuting Wang" },
  { name: "苏州市委网络安全和信息化委员会办公室", shortName: "网信办", region: "江苏省", line: "其他条线", level: "市级", contactName: "Yuting Wang" },
  { name: "苏州市商务局", shortName: "商务局", region: "江苏省", line: "商务条线", level: "市级", contactName: "Yuting Wang" },
  { name: "苏州市工商业联合会", shortName: "工商联", region: "江苏省", line: "组织人事", level: "市级", contactName: "Yuting Wang" },
  { name: "苏州市相城区委/区政府", shortName: "区委/区政府", region: "江苏省", line: "人民政府", level: "区级", contactName: "Yuting Wang" },
  { name: "苏州市相城区发展和改革委员会", shortName: "发改委", region: "江苏省", line: "发改条线", level: "区级", contactName: "Yuting Wang" },
  { name: "苏州市相城区商务局", shortName: "商务局", region: "江苏省", line: "商务条线", level: "区级", contactName: "Zoe Gu" },
  { name: "苏州市相城区工业和信息化局", shortName: "工信局", region: "江苏省", line: "工信条线", level: "区级", contactName: "Zoe Gu" },
  { name: "苏州市相城区科学技术局", shortName: "科技局", region: "江苏省", line: "科技条线", level: "区级", contactName: "Zoe Gu" },
  { name: "苏州市相城区市场监督管理局", shortName: "市监局", region: "江苏省", line: "市场监管", level: "区级", contactName: "Zoe Gu" },
  { name: "苏州市相城区人力资源和社会保障局", shortName: "人社局", region: "江苏省", line: "人社条线", level: "区级", contactName: "Yara Ying" },
  { name: "苏州市相城区民政局", shortName: "民政局", region: "江苏省", line: "民政条线", level: "区级", contactName: "Yara Ying" },
  { name: "苏州高铁新城管理委员会", shortName: "管委会", region: "江苏省", line: "人民政府", level: "板块", contactName: "Yuting Wang, Zoe Gu" },
  { name: "苏州高铁新城科技商务局", shortName: "科技商务局", region: "江苏省", line: "科技/商务", level: "板块", contactName: "Zoe Gu, Yara Ying" },
  { name: "苏州高铁新城组织人事局（党委等）", shortName: "组织人事局", region: "江苏省", line: "组织人事", level: "板块", contactName: "Zoe Gu, Yara Ying" },
  { name: "苏州高铁新城经济发展局", shortName: "经济发展局", region: "江苏省", line: "发改条线", level: "板块", contactName: "Yara Ying" },
  { name: "苏州高铁新城企业服务中心", shortName: "经服中心", region: "江苏省", line: "企业服务", level: "板块", contactName: "Zoe Gu" },
  { name: "庆阳市政治协商会议", shortName: "政协", region: "甘肃省", line: "人民政府", level: "市级", contactName: "Yuting Wang" },
  { name: "庆阳市教育局", shortName: "教育局", region: "甘肃省", line: "其他条线", level: "市级", contactName: "Yuting Wang" },
  { name: "庆阳市数据局", shortName: "数据局", region: "甘肃省", line: "数据/工信", level: "市级", contactName: "Yuting Wang" },
  { name: "庆城县委/县政府", shortName: "县委/县政府", region: "甘肃省", line: "人民政府", level: "区级", contactName: "Yuting Wang" },
  { name: "庆城县委统一战线工作部", shortName: "统战部", region: "甘肃省", line: "其他条线", level: "区级", contactName: "Yuting Wang" },
  { name: "庆城县商务局", shortName: "商务局", region: "甘肃省", line: "商务条线", level: "区级", contactName: "Yuting Wang" },
  { name: "庆城县总工会", shortName: "工会", region: "甘肃省", line: "其他条线", level: "区级", contactName: "Yuting Wang" },
  { name: "庆城县委组织部", shortName: "组织部", region: "甘肃省", line: "组织人事", level: "区级", contactName: "Yuting Wang" },
  { name: "上海市浦东新区金桥管理局", shortName: "金桥管理局", region: "上海市", line: "人民政府", level: "区级", contactName: "Yuting Wang" },
  { name: "上海市浦东新区统计局", shortName: "浦东统计局", region: "上海市", line: "其他条线", level: "区级", contactName: "Yuting Wang" },
  { name: "上海市嘉定区委/区政府", shortName: "区委/区政府", region: "上海市", line: "人民政府", level: "区级", contactName: "Yuting Wang" },
  { name: "上海市嘉定区投资促进服务中心", shortName: "投促中心", region: "上海市", line: "投资促进", level: "区级", contactName: "Yuting Wang" },
  { name: "广州市增城区科技创新局", shortName: "科创局", region: "广东省", line: "科技条线", level: "区级", contactName: "Yuting Wang" },
  { name: "广州市增城区管理委员会", shortName: "管委会", region: "广东省", line: "人民政府", level: "区级", contactName: "Yuting Wang" },
  { name: "广州市增城区统计局", shortName: "统计局", region: "广东省", line: "其他条线", level: "区级", contactName: "Yuting Wang" },
  { name: "广州市增城区工业和信息化局", shortName: "工信局", region: "广东省", line: "工信条线", level: "区级", contactName: "Yuting Wang" },
  { name: "广州市增城区人力资源和社会保障局", shortName: "人社局", region: "广东省", line: "人社条线", level: "区级", contactName: "Yuting Wang" },
  { name: "深圳市龙岗区汽车产业发展办公室", shortName: "汽车办", region: "广东省", line: "产业条线", level: "区级", contactName: "Yuting Wang" },
  { name: "深圳市龙岗区经济科技办公室", shortName: "经科办", region: "广东省", line: "科技/工信", level: "区级", contactName: "Yuting Wang" },
  { name: "深圳市坪山区发展和改革局", shortName: "发改局", region: "广东省", line: "发改条线", level: "区级", contactName: "Zoe Gu" },
  { name: "深圳市坪山区汽车产业发展办公室", shortName: "汽车办", region: "广东省", line: "产业条线", level: "区级", contactName: "Zoe Gu" },
  { name: "深圳市坪山区人力资源局", shortName: "人力资源局", region: "广东省", line: "人社条线", level: "区级", contactName: "Zoe Gu" },
  { name: "武汉经济技术开发区区委/区政府", shortName: "区委/区政府", region: "湖北省", line: "人民政府", level: "区级", contactName: "Yuting Wang" },
];

// ── 条线国家标准化清洗 ──────────────────────────────────────────────
export async function sanitizeBusinessLines() {
  const MAPPING: Record<string, string> = {
    "工信条线":   "工信",
    "发改条线":   "发改",
    "商务条线":   "商务",
    "科技条线":   "科技",
    "人社条线":   "人社",
    "民政条线":   "民政",
    "市场监管":   "市场监管",
    "企业服务":   "企服/投促",
    "投资促进":   "企服/投促",
    "产业条线":   "工信",
    "数据/工信":  "数据",
    "科技/商务":  "商务",
    "科技/工信":  "科技",
    "人民政府":   "党委/政府办公",
    "组织人事":   "党委/政府办公",
    "其他条线":   "其他",
  };

  try {
    const institutions = await prisma.odcInstitution.findMany({ select: { id: true, verticalLine: true } });
    let updated = 0;
    for (const inst of institutions) {
      const mapped = MAPPING[inst.verticalLine];
      if (mapped) {
        await prisma.odcInstitution.update({ where: { id: inst.id }, data: { verticalLine: mapped } });
        updated++;
      }
    }

    // 同步清洗 OdcBusinessLine 字典表
    const lines = await prisma.odcBusinessLine.findMany({ select: { id: true, name: true } });
    for (const line of lines) {
      const mapped = MAPPING[line.name];
      if (mapped) {
        // 如果目标名已存在则删掉旧的，否则更新
        const existing = await prisma.odcBusinessLine.findUnique({ where: { name: mapped } });
        if (existing) {
          await prisma.odcBusinessLine.delete({ where: { id: line.id } });
        } else {
          await prisma.odcBusinessLine.update({ where: { id: line.id }, data: { name: mapped } });
        }
      }
    }

    // 确保标准条线全部存在
    const STANDARD_LINES = ["发改", "工信", "科技", "商务", "网信", "数据", "交通运输", "公安交管", "自然资源", "人社", "市场监管", "企服/投促", "党委/政府办公", "其他"];
    for (let i = 0; i < STANDARD_LINES.length; i++) {
      await prisma.odcBusinessLine.upsert({
        where:  { name: STANDARD_LINES[i] },
        update: {},
        create: { name: STANDARD_LINES[i], sortOrder: i },
      });
    }

    revalidatePath("/dashboard/odc");
    return { success: true, updated };
  } catch (e) {
    console.error("[sanitizeBusinessLines]", e);
    return { success: false, error: (e as Error).message };
  }
}

// ── 核弹级重置：清空脏数据，写入 48 条国标条线标准台账 ─────────────
// line 字段已全部使用国家标准简称（工信/发改/商务/科技/人社/企服·投促/党委·政府办公/其他……）
const STANDARD_ODC_DATA = [
  { name: "江苏省委/江苏省人民政府",               shortName: "省委/省政府",    region: "江苏省", line: "党委/政府办公", level: "省级",  contactName: "Yuting Wang" },
  { name: "江苏省工业和信息化厅",                   shortName: "工信厅",          region: "江苏省", line: "工信",         level: "省级",  contactName: "Yuting Wang" },
  { name: "江苏省商务厅",                           shortName: "商务厅",          region: "江苏省", line: "商务",         level: "省级",  contactName: "Yuting Wang" },
  { name: "江苏省发展和改革委员会",                 shortName: "发改委",          region: "江苏省", line: "发改",         level: "省级",  contactName: "Yuting Wang" },
  { name: "江苏省科学技术厅",                       shortName: "科技厅",          region: "江苏省", line: "科技",         level: "省级",  contactName: "Yuting Wang" },
  { name: "苏州市委/苏州市人民政府",               shortName: "市委/市政府",    region: "江苏省", line: "党委/政府办公", level: "市级",  contactName: "Yuting Wang" },
  { name: "苏州市工业和信息化局",                   shortName: "工信局",          region: "江苏省", line: "工信",         level: "市级",  contactName: "Yuting Wang, Zoe Gu" },
  { name: "苏州市科学技术局",                       shortName: "科技局",          region: "江苏省", line: "科技",         level: "市级",  contactName: "Yuting Wang, Zoe Gu" },
  { name: "苏州市发展和改革委员会",                 shortName: "发改委",          region: "江苏省", line: "发改",         level: "市级",  contactName: "Yuting Wang" },
  { name: "苏州市委网络安全和信息化委员会办公室",   shortName: "网信办",          region: "江苏省", line: "网信",         level: "市级",  contactName: "Yuting Wang" },
  { name: "苏州市商务局",                           shortName: "商务局",          region: "江苏省", line: "商务",         level: "市级",  contactName: "Yuting Wang" },
  { name: "苏州市工商业联合会",                     shortName: "工商联",          region: "江苏省", line: "党委/政府办公", level: "市级",  contactName: "Yuting Wang" },
  { name: "苏州市相城区委/区政府",                 shortName: "区委/区政府",    region: "江苏省", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
  { name: "苏州市相城区发展和改革委员会",           shortName: "发改委",          region: "江苏省", line: "发改",         level: "区级",  contactName: "Yuting Wang" },
  { name: "苏州市相城区商务局",                     shortName: "商务局",          region: "江苏省", line: "商务",         level: "区级",  contactName: "Zoe Gu" },
  { name: "苏州市相城区工业和信息化局",             shortName: "工信局",          region: "江苏省", line: "工信",         level: "区级",  contactName: "Zoe Gu" },
  { name: "苏州市相城区科学技术局",                 shortName: "科技局",          region: "江苏省", line: "科技",         level: "区级",  contactName: "Zoe Gu" },
  { name: "苏州市相城区市场监督管理局",             shortName: "市监局",          region: "江苏省", line: "市场监管",     level: "区级",  contactName: "Zoe Gu" },
  { name: "苏州市相城区人力资源和社会保障局",       shortName: "人社局",          region: "江苏省", line: "人社",         level: "区级",  contactName: "Yara Ying" },
  { name: "苏州市相城区民政局",                     shortName: "民政局",          region: "江苏省", line: "民政",         level: "区级",  contactName: "Yara Ying" },
  { name: "苏州高铁新城管理委员会",                 shortName: "管委会",          region: "江苏省", line: "党委/政府办公", level: "板块",  contactName: "Yuting Wang, Zoe Gu" },
  { name: "苏州高铁新城科技商务局",                 shortName: "科技商务局",      region: "江苏省", line: "商务",         level: "板块",  contactName: "Zoe Gu, Yara Ying" },
  { name: "苏州高铁新城组织人事局（党委等）",       shortName: "组织人事局",      region: "江苏省", line: "党委/政府办公", level: "板块",  contactName: "Zoe Gu, Yara Ying" },
  { name: "苏州高铁新城经济发展局",                 shortName: "经济发展局",      region: "江苏省", line: "发改",         level: "板块",  contactName: "Yara Ying" },
  { name: "苏州高铁新城企业服务中心",               shortName: "经服中心",        region: "江苏省", line: "企服/投促",    level: "板块",  contactName: "Zoe Gu" },
  { name: "庆阳市政治协商会议",                     shortName: "政协",            region: "甘肃省", line: "党委/政府办公", level: "市级",  contactName: "Yuting Wang" },
  { name: "庆阳市教育局",                           shortName: "教育局",          region: "甘肃省", line: "教育",         level: "市级",  contactName: "Yuting Wang" },
  { name: "庆阳市数据局",                           shortName: "数据局",          region: "甘肃省", line: "数据",         level: "市级",  contactName: "Yuting Wang" },
  { name: "庆城县委/县政府",                       shortName: "县委/县政府",    region: "甘肃省", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
  { name: "庆城县委统一战线工作部",                 shortName: "统战部",          region: "甘肃省", line: "统战",         level: "区级",  contactName: "Yuting Wang" },
  { name: "庆城县商务局",                           shortName: "商务局",          region: "甘肃省", line: "商务",         level: "区级",  contactName: "Yuting Wang" },
  { name: "庆城县总工会",                           shortName: "工会",            region: "甘肃省", line: "其他",         level: "区级",  contactName: "Yuting Wang" },
  { name: "庆城县委组织部",                         shortName: "组织部",          region: "甘肃省", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
  { name: "上海市浦东新区金桥管理局",               shortName: "金桥管理局",      region: "上海市", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
  { name: "上海市浦东新区统计局",                   shortName: "浦东统计局",      region: "上海市", line: "其他",         level: "区级",  contactName: "Yuting Wang" },
  { name: "上海市嘉定区委/区政府",                 shortName: "区委/区政府",    region: "上海市", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
  { name: "上海市嘉定区投资促进服务中心",           shortName: "投促中心",        region: "上海市", line: "企服/投促",    level: "区级",  contactName: "Yuting Wang" },
  { name: "广州市增城区科技创新局",                 shortName: "科创局",          region: "广东省", line: "科技",         level: "区级",  contactName: "Yuting Wang" },
  { name: "广州市增城区管理委员会",                 shortName: "管委会",          region: "广东省", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
  { name: "广州市增城区统计局",                     shortName: "统计局",          region: "广东省", line: "其他",         level: "区级",  contactName: "Yuting Wang" },
  { name: "广州市增城区工业和信息化局",             shortName: "工信局",          region: "广东省", line: "工信",         level: "区级",  contactName: "Yuting Wang" },
  { name: "广州市增城区人力资源和社会保障局",       shortName: "人社局",          region: "广东省", line: "人社",         level: "区级",  contactName: "Yuting Wang" },
  { name: "深圳市龙岗区汽车产业发展办公室",         shortName: "汽车办",          region: "广东省", line: "工信",         level: "区级",  contactName: "Yuting Wang" },
  { name: "深圳市龙岗区经济科技办公室",             shortName: "经科办",          region: "广东省", line: "科技",         level: "区级",  contactName: "Yuting Wang" },
  { name: "深圳市坪山区发展和改革局",               shortName: "发改局",          region: "广东省", line: "发改",         level: "区级",  contactName: "Zoe Gu" },
  { name: "深圳市坪山区汽车产业发展办公室",         shortName: "汽车办",          region: "广东省", line: "工信",         level: "区级",  contactName: "Zoe Gu" },
  { name: "深圳市坪山区人力资源局",                 shortName: "人力资源局",      region: "广东省", line: "人社",         level: "区级",  contactName: "Zoe Gu" },
  { name: "武汉经济技术开发区区委/区政府",         shortName: "区委/区政府",    region: "湖北省", line: "党委/政府办公", level: "区级",  contactName: "Yuting Wang" },
];

export async function hardResetOdcData() {
  try {
    // 1. 安全级联删除（按外键顺序）
    const existing = await prisma.odcInstitution.findMany({ select: { id: true } });
    for (const inst of existing) {
      await prisma.odcSubDepartment.deleteMany({ where: { institutionId: inst.id } });
      await prisma.odcLeader.deleteMany({ where: { institutionId: inst.id } });
      await prisma.institutionIntelligence.deleteMany({ where: { institutionId: inst.id } });
    }
    await prisma.odcInstitution.deleteMany({});

    // 2. 确保标准条线字典存在
    const STANDARD_LINES = [
      "发改", "工信", "科技", "商务", "网信", "数据",
      "交通运输", "公安交管", "自然资源", "人社", "市场监管",
      "企服/投促", "党委/政府办公", "民政", "教育", "统战", "其他",
    ];
    for (let i = 0; i < STANDARD_LINES.length; i++) {
      await prisma.odcBusinessLine.upsert({
        where:  { name: STANDARD_LINES[i] },
        update: {},
        create: { name: STANDARD_LINES[i], sortOrder: i },
      });
    }

    // 3. 写入 48 条标准机构
    let inserted = 0;
    for (const d of STANDARD_ODC_DATA) {
      const divisions = d.contactName
        ? d.contactName.split(",").map(n => ({ name: d.name, assigneeName: n.trim() }))
        : [];
      await prisma.odcInstitution.create({
        data: {
          shortName:    d.shortName,
          fullName:     d.name,
          jurisdiction: d.region,
          verticalLine: d.line,
          level:        d.level,
          divisions:    divisions as object[],
        },
      });
      inserted++;
    }

    revalidatePath("/dashboard/odc");
    return { success: true, inserted };
  } catch (e) {
    console.error("[hardResetOdcData]", e);
    return { success: false, error: (e as Error).message };
  }
}

export async function seedOdcInstitutions() {
  try {
    const session = await getSession();
    if (!session?.user) return { success: false, error: "未登录" };

    // 1. 清空旧机构数据（及关联子表）
    const existing = await prisma.odcInstitution.findMany({ select: { id: true } });
    for (const inst of existing) {
      await prisma.odcSubDepartment.deleteMany({ where: { institutionId: inst.id } });
      await prisma.odcLeader.deleteMany({ where: { institutionId: inst.id } });
      await prisma.institutionIntelligence.deleteMany({ where: { institutionId: inst.id } });
    }
    await prisma.odcInstitution.deleteMany({});

    // 2. 收集所有需要的条线，确保存在于 DB
    const neededLines = Array.from(new Set(INITIAL_ODC_DATA.map(d => d.line)));
    for (const lineName of neededLines) {
      await prisma.odcBusinessLine.upsert({
        where:  { name: lineName },
        update: {},
        create: { name: lineName, sortOrder: 99 },
      });
    }

    // 3. 批量插入 48 条机构
    let inserted = 0;
    for (const d of INITIAL_ODC_DATA) {
      const divisions = d.contactName
        ? d.contactName.split(",").map(n => ({ name: d.name, assigneeName: n.trim() }))
        : [];
      await prisma.odcInstitution.create({
        data: {
          shortName:    d.shortName,
          fullName:     d.name,
          jurisdiction: d.region,
          verticalLine: d.line,
          level:        d.level,
          divisions:    divisions as object[],
        },
      });
      inserted++;
    }

    revalidatePath("/dashboard/odc");
    return { success: true, inserted };
  } catch (e) {
    console.error("[seedOdcInstitutions]", e);
    return { success: false, error: (e as Error).message };
  }
}
