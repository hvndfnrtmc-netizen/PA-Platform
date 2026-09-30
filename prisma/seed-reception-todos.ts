/**
 * 政府接待待办模板预设数据 seed
 * 执行方式：cd pa-platform && npx tsx prisma/seed-reception-todos.ts
 *
 * 数据结构：一级模板（大类）→ 二级子任务（parentId 自关联）
 * 重复执行安全：category+title+parentId 三字段联合查找，已存在则跳过
 */

import { PrismaClient, TodoActionType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const pool    = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

// ── URL 常量（与 receptionTodoConstants.ts 保持一致）──────────────────────────

const FEISHU_ROOM_BOOK_URL  = "https://applink.feishu.cn/client/calendar/room_book";
const FEISHU_CALENDAR_URL   = "https://applink.feishu.cn/client/calendar/view";
const RESERVE_VEHICLE_URL   = "https://fmp.momenta.works/reserveVehicle";
const MTOUR_TABLE_URL       = "https://applink.feishu.cn/client/mini_program/open?appId=cli_a1b2c3d4e5f6&path=pages/table/index";

// ── 模板数据定义 ──────────────────────────────────────────────────────────────

interface ChildTemplate {
  title:             string;
  defaultActionType: TodoActionType;
  defaultActionValue?: string;
  order:             number;
}

interface ParentTemplate {
  category:          string;
  title:             string;
  defaultActionType: TodoActionType;
  defaultActionValue?: string;
  order:             number;
  children:          ChildTemplate[];
}

const TEMPLATES: ParentTemplate[] = [
  // ── 1. 展厅预约 ─────────────────────────────────────────────────────────────
  {
    category:          "展厅预约",
    title:             "展厅预约",
    defaultActionType: TodoActionType.URL,
    defaultActionValue: FEISHU_ROOM_BOOK_URL,
    order:             10,
    children: [],
  },

  // ── 2. 会议室预约 ────────────────────────────────────────────────────────────
  {
    category:          "会议室预约",
    title:             "会议室预约",
    defaultActionType: TodoActionType.URL,
    defaultActionValue: FEISHU_ROOM_BOOK_URL,
    order:             20,
    children: [],
  },

  // ── 3. 日程创建 ──────────────────────────────────────────────────────────────
  {
    category:          "日程创建",
    title:             "日程创建",
    defaultActionType: TodoActionType.URL,
    defaultActionValue: FEISHU_CALENDAR_URL,
    order:             30,
    children: [],
  },

  // ── 4. 非申请行政支持 ────────────────────────────────────────────────────────
  {
    category:          "非申请行政支持",
    title:             "非申请行政支持",
    defaultActionType: TodoActionType.NONE,
    order:             40,
    children: [
      { title: "请admin支持矿泉水/泡茶", defaultActionType: TodoActionType.NONE, order: 1 },
      { title: "请admin支持三件套",       defaultActionType: TodoActionType.NONE, order: 2 },
    ],
  },

  // ── 5. 需申请行政流程 ────────────────────────────────────────────────────────
  {
    category:          "需申请行政流程",
    title:             "需申请行政流程",
    defaultActionType: TodoActionType.NONE,
    order:             50,
    children: [
      { title: "oa提报重点访客接待申请单", defaultActionType: TodoActionType.NONE, order: 1 },
    ],
  },

  // ── 6. 展车沟通 ──────────────────────────────────────────────────────────────
  {
    category:          "展车沟通",
    title:             "展车沟通",
    defaultActionType: TodoActionType.NONE,
    order:             60,
    children: [
      { title: "建立展车执行群",               defaultActionType: TodoActionType.FEISHU_CHAT, order: 1 },
      { title: "整理展车套餐并在展车群沟通",     defaultActionType: TodoActionType.NONE,       order: 2 },
      { title: "约车",                          defaultActionType: TodoActionType.URL,        defaultActionValue: RESERVE_VEHICLE_URL, order: 3 },
      { title: "会前群里确认展车",               defaultActionType: TodoActionType.NONE,       order: 4 },
      { title: "会后群里感谢展车",               defaultActionType: TodoActionType.NONE,       order: 5 },
    ],
  },

  // ── 7. Mtour沟通 ─────────────────────────────────────────────────────────────
  {
    category:          "Mtour沟通",
    title:             "Mtour沟通",
    defaultActionType: TodoActionType.NONE,
    order:             70,
    children: [
      { title: "建立Mtour执行群",       defaultActionType: TodoActionType.FEISHU_CHAT, order: 1 },
      { title: "群里预约询问",           defaultActionType: TodoActionType.NONE,       order: 2 },
      { title: "确认有车后约Mtour",      defaultActionType: TodoActionType.URL,        defaultActionValue: MTOUR_TABLE_URL, order: 3 },
      { title: "在群里接收体验车信息",    defaultActionType: TodoActionType.NONE,       order: 4 },
      { title: "体验前群里再次确认",      defaultActionType: TodoActionType.NONE,       order: 5 },
      { title: "结束后在群里感谢",        defaultActionType: TodoActionType.NONE,       order: 6 },
    ],
  },

  // ── 8. 物业支持 ──────────────────────────────────────────────────────────────
  {
    category:          "物业支持",
    title:             "物业支持",
    defaultActionType: TodoActionType.NONE,
    order:             80,
    children: [
      { title: "提前沟通石墩子和一米栏", defaultActionType: TodoActionType.NONE, order: 1 },
    ],
  },

  // ── 9. 工作餐 ────────────────────────────────────────────────────────────────
  {
    category:          "工作餐",
    title:             "工作餐",
    defaultActionType: TodoActionType.NONE,
    order:             90,
    children: [
      { title: "oa提报重点访客接待申请单",         defaultActionType: TodoActionType.NONE, order: 1 },
      { title: "与admin拉通需求，规格、数量、时间等", defaultActionType: TodoActionType.NONE, order: 2 },
    ],
  },

  // ── 10. 商务宴请 ─────────────────────────────────────────────────────────────
  {
    category:          "商务宴请",
    title:             "商务宴请",
    defaultActionType: TodoActionType.NONE,
    order:             100,
    children: [
      { title: "提前预约餐厅包间",                       defaultActionType: TodoActionType.NONE, order: 1 },
      { title: "提前确定是否饮酒，及种类、品牌，提前准备在包间", defaultActionType: TodoActionType.NONE, order: 2 },
    ],
  },

  // ── 11. 住宿 ─────────────────────────────────────────────────────────────────
  {
    category:          "住宿",
    title:             "住宿",
    defaultActionType: TodoActionType.NONE,
    order:             110,
    children: [
      { title: "提前与admin咨询实时操作流程",               defaultActionType: TodoActionType.NONE, order: 1 },
      { title: "苏州通常首选金科、木莲庄，可协议价预约",    defaultActionType: TodoActionType.NONE, order: 2 },
    ],
  },

  // ── 12. 交通 ─────────────────────────────────────────────────────────────────
  {
    category:          "交通",
    title:             "交通",
    defaultActionType: TodoActionType.NONE,
    order:             120,
    children: [
      { title: "与MGO车务进行协调",       defaultActionType: TodoActionType.NONE, order: 1 },
      { title: "如无资源匹配，自行下单准备", defaultActionType: TodoActionType.NONE, order: 2 },
    ],
  },

  // ── 13. 伴手礼 ───────────────────────────────────────────────────────────────
  {
    category:          "伴手礼",
    title:             "伴手礼",
    defaultActionType: TodoActionType.NONE,
    order:             130,
    children: [
      { title: "公司周边可提前通过耗材管理平台进行查看，提交需求（司服、夹克、本子、水杯等）", defaultActionType: TodoActionType.NONE, order: 1 },
    ],
  },
];

// ── 执行 seed ─────────────────────────────────────────────────────────────────

async function main() {
  let created = 0;
  let skipped = 0;

  for (const tpl of TEMPLATES) {
    // 查找或创建一级模板
    const existing = await prisma.receptionTodoTemplate.findFirst({
      where: { category: tpl.category, title: tpl.title, parentId: null },
    });

    let parentId: string;
    if (existing) {
      parentId = existing.id;
      skipped++;
    } else {
      const created_tpl = await prisma.receptionTodoTemplate.create({
        data: {
          category:          tpl.category,
          title:             tpl.title,
          defaultActionType: tpl.defaultActionType,
          defaultActionValue: tpl.defaultActionValue ?? null,
          parentId:          null,
          order:             tpl.order,
        },
      });
      parentId = created_tpl.id;
      created++;
    }

    // 查找或创建二级子任务
    for (const child of tpl.children) {
      const childExisting = await prisma.receptionTodoTemplate.findFirst({
        where: { category: tpl.category, title: child.title, parentId },
      });
      if (childExisting) {
        skipped++;
      } else {
        await prisma.receptionTodoTemplate.create({
          data: {
            category:           tpl.category,
            title:              child.title,
            defaultActionType:  child.defaultActionType,
            defaultActionValue: child.defaultActionValue ?? null,
            parentId,
            order:              child.order,
          },
        });
        created++;
      }
    }
  }

  console.log(`✅ Seed 完成：新建 ${created} 条，跳过 ${skipped} 条（已存在）`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
