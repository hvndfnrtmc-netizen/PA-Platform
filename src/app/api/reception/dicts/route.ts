/**
 * GET  /api/reception/dicts?category=format   查询字典（返回平铺 rows + 树形 tree）
 * POST /api/reception/dicts                   新增选项（支持 parentId）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ReceptionDictionary } from "@prisma/client";

const ALLOWED_CATEGORIES = ["level", "format", "purpose", "status", "dressCode", "host"] as const;

// format 和 host 均支持两级
const SUPPORTS_HIERARCHY = new Set<string>(["format", "host"]);

// host 分类的层级默认值（父级数组 → 子级数组）
// 通过播种脚本写入，这里只用于 UI 提示，不再 hard-code 到前端
const DEFAULTS: Record<string, string[]> = {
  level:     ["区级", "市级", "省级", "国家级"],
  format:    ["展厅", "展车", "Mtour", "座谈", "参会", "发言", "物业支持"],
  purpose:   ["企业交流", "政府调研", "政府会议", "项目审查"],
  status:    ["正常", "取消"],
  dressCode: ["正装", "司服"],
  host:      [], // host 层级结构由迁移脚本播种，不自动 flat-seed
};

export interface DictNode {
  id:        string;
  value:     string;
  parentId:  string | null;
  isDefault: boolean;
  sortOrder: number;
  children:  DictNode[];
}

function buildTree(rows: ReceptionDictionary[]): DictNode[] {
  const map = new Map<string, DictNode>();
  const roots: DictNode[] = [];

  for (const r of rows) {
    map.set(r.id, { id: r.id, value: r.value, parentId: r.parentId, isDefault: r.isDefault, sortOrder: r.sortOrder, children: [] });
  }
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // 每层按 sortOrder 排序
  const sort = (nodes: DictNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const category = req.nextUrl.searchParams.get("category") ?? "";

  if (category) {
    const builtins = DEFAULTS[category] ?? [];

    // 首次访问时自动播种内置默认值：确保硬编码默认值拥有真实 DB ID
    // 这样前端 EditableCreatableSelect 可以对它们显示编辑/删除图标
    const existingCount = await prisma.receptionDictionary.count({ where: { category } });
    if (existingCount === 0 && builtins.length > 0) {
      await prisma.receptionDictionary.createMany({
        data: builtins.map((value, i) => ({
          category,
          value,
          sortOrder:  i,
          isDefault:  false, // 入库后与用户自建选项平等，可编辑/删除
          isActive:   true,
          parentId:   null,
        })),
        skipDuplicates: true,
      });
    }

    // 下拉选项：只返回活跃（isActive=true）的记录
    const rows = await prisma.receptionDictionary.findMany({
      where:   { category, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    // 历史 ID 映射用：包含已停用项
    const allRows = await prisma.receptionDictionary.findMany({
      where:   { category },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select:  { id: true, value: true, parentId: true, isActive: true, isDefault: true, sortOrder: true },
    });

    // values：只取 DB 活跃值（默认值已播种，不再需要与硬编码合并）
    const values = rows.filter((r) => !r.parentId).map((r) => r.value);

    const tree = SUPPORTS_HIERARCHY.has(category) ? buildTree(rows) : null;
    return NextResponse.json({ values, rows, tree, allRows });
  }

  // 无 category → 返回全部
  const rows = await prisma.receptionDictionary.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = (await req.json()) as { category?: string; value?: string; parentId?: string | null };
  const { category, value, parentId = null } = body;

  if (!category?.trim() || !value?.trim())
    return NextResponse.json({ error: "category 和 value 不能为空" }, { status: 400 });

  if (!(ALLOWED_CATEGORIES as readonly string[]).includes(category))
    return NextResponse.json({ error: `category 必须为 ${ALLOWED_CATEGORIES.join(" | ")}` }, { status: 400 });

  // parentId 校验
  if (parentId) {
    if (!SUPPORTS_HIERARCHY.has(category))
      return NextResponse.json({ error: `${category} 分类不支持子级` }, { status: 400 });
    const parent = await prisma.receptionDictionary.findUnique({ where: { id: parentId } });
    if (!parent || parent.category !== category)
      return NextResponse.json({ error: "父级选项不存在或分类不匹配" }, { status: 400 });
    if (parent.parentId !== null)
      return NextResponse.json({ error: "不支持超过两级的嵌套" }, { status: 400 });
  }

  // 同层级（同 category + 同 parentId）下不允许重名；不同父级可以同名
  const existing = await prisma.receptionDictionary.findFirst({
    where: { category, value: value.trim(), parentId: parentId ?? null },
  });
  if (existing) {
    // 幂等：已存在则直接返回
    return NextResponse.json({ row: existing }, { status: 201 });
  }

  const row = await prisma.receptionDictionary.create({
    data: { category, value: value.trim(), parentId: parentId ?? null, isDefault: false },
  });

  return NextResponse.json({ row }, { status: 201 });
}
