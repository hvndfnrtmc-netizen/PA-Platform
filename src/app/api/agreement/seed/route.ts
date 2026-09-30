/**
 * POST /api/agreement/seed — 初始化 12 项质性义务（幂等，admin only）
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const SEED_DATA = [
  {
    code: "HQ_COMPLIANCE",
    name: "总部落户合规",
    articleRef: "第1.1.3条（一）",
    requirement: "保持苏州高新区注册法人资格，维持运营总部实质性入驻，不得随意迁移注册地或实际经营地",
  },
  {
    code: "REVENUE_ATTRIBUTION",
    name: "营业收入归属",
    articleRef: "第1.1.3条（二）",
    requirement: "确保苏州主体营业收入按协议比例如实归属本地，不得通过关联交易将收入转移至外地主体",
  },
  {
    code: "IPO_TARGET",
    name: "上市目标",
    articleRef: "第1.1.3条（三）",
    requirement: "2027年12月31日前完成资本市场上市（境内外均可），或取得相应监管机构受理通知",
  },
  {
    code: "SHAREHOLDING",
    name: "股权结构稳定",
    articleRef: "第1.1.3条（四）",
    requirement: "保持协议签署时核心股东持股结构，发生股权重大变更须提前报备管委会并取得书面确认",
  },
  {
    code: "CORE_TEAM",
    name: "核心团队留苏",
    articleRef: "第1.1.3条（五）",
    requirement: "在苏注册主体核心岗位劳动关系人员不低于300人，与苏州法人主体签署正式劳动合同",
  },
  {
    code: "INDUSTRY_CHAIN_OB",
    name: "产业链引培",
    articleRef: "第1.1.3条（六）",
    requirement: "积极引培产业链上下游企业在苏注册落户，配合管委会开展招商引资工作",
  },
  {
    code: "HQ_BUILDING",
    name: "总部大厦建设",
    articleRef: "第1.1.3条（七）",
    requirement: "2029年12月31日前完成总部大厦建设并投入使用，建筑面积及选址须符合协议约定",
  },
  {
    code: "SPECIAL_FUNDS",
    name: "专项资金专用",
    articleRef: "第1.1.3条（八）",
    requirement: "政府专项扶持资金须专款专用，不得挪作他用，并在指定期限内完成使用且提供明细报告",
  },
  {
    code: "SHAREHOLDER_TAX",
    name: "股东纳税",
    articleRef: "第1.1.3条（九）",
    requirement: "股东所持股权对应收益依法在苏州缴纳个人所得税，不得通过境外架构规避纳税义务",
  },
  {
    code: "CONTINUOUS_OPS",
    name: "持续经营承诺",
    articleRef: "第1.1.3条（十）",
    requirement: "协议期内持续经营不少于8年，不得提前解散或注销苏州主体，否则须承担违约责任",
  },
  {
    code: "CHANGE_NOTICE",
    name: "重大变更告知",
    articleRef: "第1.1.3条（十一）",
    requirement: "发生重大变更事项（含股权、管理层、业务方向等）须提前30日以书面形式通知管委会",
  },
  {
    code: "AUDIT_COOPERATION",
    name: "审计配合义务",
    articleRef: "第1.1.3条（十二）",
    requirement: "积极配合政府及其委托机构开展年度审计工作，在指定时间内提供完整财务及经营数据",
  },
];

export async function POST() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const role = session.user.role ?? "";
  if (!["SUPER_ADMIN", "ADMIN", "admin"].includes(role))
    return NextResponse.json({ error: "权限不足，仅管理员可初始化" }, { status: 403 });

  try {
    let created = 0;
    let skipped = 0;

    for (const item of SEED_DATA) {
      const exists = await prisma.qualitativeObligation.findUnique({ where: { code: item.code } });
      if (exists) { skipped++; continue; }
      await prisma.qualitativeObligation.create({ data: { ...item, status: "pending" } });
      created++;
    }

    return NextResponse.json({
      ok:      true,
      created,
      skipped,
      message: `已创建 ${created} 条，跳过 ${skipped} 条`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
