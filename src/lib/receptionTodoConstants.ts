/**
 * 政府接待待办大类 → 子任务映射（纯常量，可在客户端和服务端安全引用）
 */

export const FEISHU_CALENDAR_URL = "https://applink.feishu.cn/client/calendar/view";
export const FEISHU_ROOM_BOOK_URL = "https://applink.feishu.cn/client/calendar/room_book";
export const RESERVE_VEHICLE_URL  = "https://fmp.momenta.works/reserveVehicle";
// 飞书多维表格 Mtour 需求视图（请替换为实际 URL）
export const MTOUR_TABLE_URL = "https://applink.feishu.cn/client/mini_program/open?appId=cli_a1b2c3d4e5f6&path=pages/table/index";

export interface TodoTaskTemplate {
  content: string;   // 支持 {{DATE}} {{TITLE}} {{FORMATS}} 占位符
  link?:   string;
}

export const TODO_CATEGORY_TASKS: Record<string, TodoTaskTemplate[]> = {
  // ── 1 ────────────────────────────────────────────────────────
  "展厅预约": [
    { content: "飞书→日历→展厅book", link: FEISHU_ROOM_BOOK_URL },
  ],
  // ── 2 ────────────────────────────────────────────────────────
  "会议室预约": [
    { content: "飞书→日历→会议室book", link: FEISHU_ROOM_BOOK_URL },
  ],
  // ── 3 ────────────────────────────────────────────────────────
  "日程创建": [
    { content: "{{DATE}} {{TITLE}} {{FORMATS}}，邀请相关人员加入", link: FEISHU_CALENDAR_URL },
  ],
  // ── 4 ── 新增 ─────────────────────────────────────────────────
  "非申请行政支持": [
    { content: "请admin支持矿泉水/泡茶" },
    { content: "请admin支持三件套" },
  ],
  // ── 5 ── 新增 ─────────────────────────────────────────────────
  "需申请行政流程": [
    { content: "oa提报重点访客接待申请单" },
  ],
  // ── 6 ────────────────────────────────────────────────────────
  "展车沟通": [
    { content: "建立展车执行群" },
    { content: "整理展车套餐并在展车群沟通" },
    { content: "约车", link: RESERVE_VEHICLE_URL },
    { content: "会前群里确认展车" },
    { content: "会后群里感谢展车" },
  ],
  // ── 7 ── 新增第 5 条 ──────────────────────────────────────────
  "Mtour沟通": [
    { content: "建立Mtour执行群" },
    { content: "群里预约询问" },
    { content: "确认有车后约Mtour", link: MTOUR_TABLE_URL },
    { content: "在群里接收体验车信息" },
    { content: "体验前群里再次确认" },
    { content: "结束后在群里感谢" },
  ],
  // ── 8 ── 从末尾移至此处 ────────────────────────────────────────
  "物业支持": [
    { content: "提前沟通石墩子和一米栏" },
  ],
  // ── 9 ────────────────────────────────────────────────────────
  "工作餐": [
    { content: "oa提报重点访客接待申请单" },
    { content: "与admin拉通需求，规格、数量、时间等" },
  ],
  // ── 10 ───────────────────────────────────────────────────────
  "商务宴请": [
    { content: "提前预约餐厅包间" },
    { content: "提前确定是否饮酒，及种类、品牌，提前准备在包间" },
  ],
  // ── 11 ───────────────────────────────────────────────────────
  "住宿": [
    { content: "提前与admin咨询实时操作流程" },
    { content: "苏州通常首选金科、木莲庄，可协议价预约" },
  ],
  // ── 12 ───────────────────────────────────────────────────────
  "交通": [
    { content: "与MGO车务进行协调" },
    { content: "如无资源匹配，自行下单准备" },
  ],
  // ── 13 ───────────────────────────────────────────────────────
  "伴手礼": [
    { content: "公司周边可提前通过耗材管理平台进行查看，提交需求（司服、夹克、本子、水杯等）" },
  ],
};

export const TODO_CATEGORIES = Object.keys(TODO_CATEGORY_TASKS);

/** 将模板内容中的占位符替换为接待实际值 */
export function interpolateContent(
  content: string,
  ctx: { startTime: string; title: string; formats: string[] },
): string {
  const d   = new Date(ctx.startTime);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  return content
    .replace("{{DATE}}",    date)
    .replace("{{TITLE}}",   ctx.title)
    .replace("{{FORMATS}}", ctx.formats.join("、") || "");
}
