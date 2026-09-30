/**
 * GET  /api/party-transfer/record
 *   SUPER_ADMIN → 所有记录（Task 6：严格排除 DRAFT）
 *   普通用户    → 自己的最新记录（含 DRAFT，允许续编）
 *
 * POST /api/party-transfer/record  — 创建/更新草稿或提交申请
 *
 * PUT  /api/party-transfer/record  — 管理员操作（审核通过/驳回/细粒度材料标记）
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath }            from "next/cache";
import prisma                        from "@/lib/prisma";
import { getSession }                from "@/lib/auth";

// ── 序列化清洗：剔除无法存入 JSON 的 File/Blob/函数 等对象 ─────────
function cleanForStorage(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(cleanForStorage);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === "function") continue;
    if (v instanceof Blob) continue; // 剔除 File/Blob 对象
    result[k] = cleanForStorage(v);
  }
  return result;
}

// ── 状态标签映射 ───────────────────────────────────────────────────
export const STATUS_LABELS: Record<string, string> = {
  DRAFT:                     "草稿",
  SUBMITTED:                 "已提交",
  REJECTED:                  "已驳回",
  COMPLETED:                 "已完成",
  STAGE1_SUBMITTED:          "阶段一待审核",
  STAGE1_REJECTED:           "阶段一待修改",
  STAGE1_COMPANY_APPROVED:   "单位审核通过",
  STAGE1_COMMITTEE_APPROVED: "党委审核通过",
};

// ── GET ────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  if (session.user.role === "SUPER_ADMIN") {
    // Task 6：审批工作台严格排除 DRAFT
    const records = await prisma.partyTransferRecord.findMany({
      where:   { status: { not: "DRAFT" } },
      orderBy: [
        { status: "asc" }, // STAGE1_SUBMITTED 靠前
        { createdAt: "desc" },
      ],
    });
    return NextResponse.json({ records });
  }

  // 普通用户：返回自己的最新记录（含 DRAFT）
  const record = await prisma.partyTransferRecord.findFirst({
    where:   { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ record: record ?? null });
}

// ── POST — 创建或更新草稿 / 提交 ────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: {
    transferType?:     string;
    materials?:        Record<string, unknown>;
    currentStage?:     string;
    status?:           string;
    draftData?:        Record<string, unknown>;
    targetBranchName?: string;
    realName?:         string;
    idCardNumber?:     string;
    partyFeeData?:     unknown;
    collectedInfo?:    unknown;
    stage4ModifyRequested?: boolean;
    stage1WithdrawRequested?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  // 阶段二：强制 Upsert — 查询该用户最新记录（不限状态），确保始终能找到目标行
  // 原先只找 DRAFT/REJECTED/STAGE1_REJECTED，导致 STAGE1_SUBMITTED 记录无法被定位，
  // 后端静默 create 新行，刷新后用户看到的是空行而非真实草稿。
  const existing = await prisma.partyTransferRecord.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const newStatus = body.status ?? "DRAFT";

  // 🛡️ 防御：已提交/已审核状态不可被 POST 覆盖（防止重复提交和数据篡改）
  // 例外：撤回请求（stage1WithdrawRequested=true）允许通过
  const POST_LOCKED_STATUSES = new Set([
    "STAGE1_SUBMITTED", "STAGE1_COMPANY_APPROVED",
    "STAGE1_COMMITTEE_APPROVED", "SUBMITTED", "COMPLETED",
  ]);
  if (existing && POST_LOCKED_STATUSES.has(existing.status) && body.stage1WithdrawRequested !== true) {
    return NextResponse.json(
      { error: `记录当前状态为「${STATUS_LABELS[existing.status] ?? existing.status}」，不可修改` },
      { status: 409 }
    );
  }

  // 清洗 draftData：剔除 File/Blob 等无法序列化的对象
  const cleanedDraftData = body.draftData
    ? cleanForStorage(body.draftData) as object
    : undefined;

  if (existing) {
    const updated = await prisma.partyTransferRecord.update({
      where: { id: existing.id },
      data: {
        currentStage:     body.currentStage     ?? existing.currentStage,
        materials:        (body.materials       ?? existing.materials) as object,
        draftData:        cleanedDraftData ?? (existing.draftData as object | undefined),
        status:           newStatus,
        targetBranchName: body.targetBranchName ?? existing.targetBranchName ?? undefined,
        realName:         body.realName         ?? existing.realName         ?? undefined,
        idCardNumber:     body.idCardNumber     ?? existing.idCardNumber     ?? undefined,
        partyFeeData:     body.partyFeeData !== undefined ? (body.partyFeeData as object) : (existing.partyFeeData as object | undefined) ?? undefined,
        collectedInfo:    body.collectedInfo !== undefined ? (body.collectedInfo as object) : (existing.collectedInfo as object | undefined) ?? undefined,
        stage4ModifyRequested: body.stage4ModifyRequested !== undefined ? body.stage4ModifyRequested : existing.stage4ModifyRequested,
        stage1WithdrawRequested: body.stage1WithdrawRequested !== undefined ? body.stage1WithdrawRequested : existing.stage1WithdrawRequested,
      },
    });
    // 任务一：每次保存均击穿页面缓存，确保刷新后能拿到最新草稿
    revalidatePath("/dashboard/party-transfer", "page");
    return NextResponse.json({ record: updated });
  }

  const created = await prisma.partyTransferRecord.create({
    data: {
      userId:           session.user.id,
      userName:         session.user.name ?? "未知用户",
      transferType:     body.transferType     ?? "转入申请",
      currentStage:     body.currentStage     ?? "档案上传",
      status:           newStatus,
      materials:        (body.materials       ?? {}) as object,
      draftData:        cleanedDraftData,
      targetBranchName: body.targetBranchName ?? null,
      realName:         body.realName         ?? null,
      idCardNumber:     body.idCardNumber     ?? null,
      partyFeeData:     body.partyFeeData ? (body.partyFeeData as object) : undefined,
    },
  });
  // 任务一：每次保存均击穿页面缓存
  revalidatePath("/dashboard/party-transfer", "page");
  return NextResponse.json({ record: created });
}

// ── PUT — 管理员操作：审核通过 / 驳回 / 细粒度材料标记 ──────────────
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  let body: {
    id:           string;
    action:       "company_approve" | "committee_approve" | "reject" | "complete" | "unlock_stage4" | "admin_edit_ledger" | "allow_stage1_withdraw";
    rejectReason?: string;
    materialUpdates?: Record<string, Array<{ name: string; url: string; status?: string; rejectReason?: string }>>;
    collectedInfo?: unknown;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  const record = await prisma.partyTransferRecord.findUnique({ where: { id: body.id } });
  if (!record) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  let newStatus: string;
  const updateData: Record<string, unknown> = {};

  switch (body.action) {
    case "company_approve":
      newStatus = "STAGE1_COMPANY_APPROVED";
      break;
    case "committee_approve":
      newStatus = "STAGE1_COMMITTEE_APPROVED";
      break;
    case "reject": {
      newStatus = "STAGE1_REJECTED";
      // 从 materialUpdates 收集被驳回的文件及其逐条理由
      const rejectedFiles: { category: string; fileName: string; reason: string }[] = [];
      for (const [cat, files] of Object.entries(body.materialUpdates ?? {})) {
        for (const f of files) {
          if (f.status === "REJECTED" && f.rejectReason?.trim()) {
            rejectedFiles.push({ category: cat, fileName: f.name, reason: f.rejectReason.trim() });
          }
        }
      }
      if (rejectedFiles.length === 0)
        return NextResponse.json({ error: "至少需要一条带驳回原因的文件" }, { status: 400 });
      // 追加本轮驳回记录到历史
      type RejectionRound = { round: number; rejectedAt: string; files: { category: string; fileName: string; reason: string }[] };
      const history = ((record.rejectionHistory as RejectionRound[]) ?? []);
      updateData.rejectionHistory = [
        ...history,
        { round: history.length + 1, rejectedAt: new Date().toISOString(), files: rejectedFiles },
      ];
      break;
    }
    case "complete":
      newStatus = "COMPLETED";
      break;
    case "unlock_stage4":
      // 管理员退回允许员工修改 Stage4 台账
      updateData.stage4ModifyRequested = false;
      updateData.status = record.status; // 状态不变
      await prisma.partyTransferRecord.update({
        where: { id: body.id },
        data: updateData as Parameters<typeof prisma.partyTransferRecord.update>[0]["data"],
      });
      return NextResponse.json({ ok: true });
    case "admin_edit_ledger":
      // 管理员直接修改台账
      if (!body.collectedInfo) return NextResponse.json({ error: "缺少台账数据" }, { status: 400 });
      await prisma.partyTransferRecord.update({
        where: { id: body.id },
        data: { collectedInfo: body.collectedInfo as object },
      });
      return NextResponse.json({ ok: true });
    case "allow_stage1_withdraw":
      // 管理员同意撤回：重置状态为 DRAFT，清空撤回标记
      await prisma.partyTransferRecord.update({
        where: { id: body.id },
        data: { status: "DRAFT", stage1WithdrawRequested: false },
      });
      revalidatePath("/dashboard/party-transfer", "page");
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }

  newStatus = newStatus!;
  updateData.status = newStatus;

  // 如果有材料级别的状态更新（细粒度驳回/通过）
  if (body.materialUpdates) {
    updateData.materials = body.materialUpdates as object;
  }

  const updated = await prisma.partyTransferRecord.update({
    where: { id: body.id },
    data: updateData as Parameters<typeof prisma.partyTransferRecord.update>[0]["data"],
  });

  revalidatePath("/dashboard/party-transfer", "page");
  return NextResponse.json({ record: updated });
}
