import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { ReadOnlyEnforcer } from "@/components/layout/ReadOnlyEnforcer";
import prisma from "@/lib/prisma";
import { SIDEBAR_CONFIG_KEY, parseSidebarConfig, isReadOnlyAccount } from "@/lib/sidebar-config";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // DEPT_CONTACT 需要从 DB 获取其部门被授权的模块列表
  let grantedModuleKeys: string[] = [];
  if (session.user.role === "DEPT_CONTACT" && session.user.departmentId) {
    const now   = new Date();
    const perms = await prisma.modulePermission.findMany({
      where: {
        departmentId: session.user.departmentId,
        isActive:     true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: { moduleKey: true },
    });
    grantedModuleKeys = perms.map((p) => p.moduleKey);
  }

  // 党员关系模块个人白名单：SUPER_ADMIN 默认放行，其余查库
  const hasPartyModuleAccess =
    session.user.role === "SUPER_ADMIN"
      ? true
      : await prisma.user
          .findUnique({
            where:  { id: session.user.id },
            select: { hasPartyModuleAccess: true },
          })
          .then((u) => u?.hasPartyModuleAccess ?? false);

  // FeishuNotificationTarget 模块授权（非 SUPER_ADMIN 时查询）
  let feishuAuthorizedModules: string[] | null = null;
  if (session.user.role !== "SUPER_ADMIN") {
    const user = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { feishuOpenId: true },
    });
    if (user?.feishuOpenId) {
      const target = await prisma.feishuNotificationTarget.findUnique({
        where:  { feishuId: user.feishuOpenId },
        select: { modules: true },
      });
      if (target) {
        feishuAuthorizedModules = target.modules;
      }
    }
  }

  // 侧边栏显示配置（超级后台 → 侧边栏菜单）。表内无记录时按默认全放行处理，
  // 不在此处 seed 写库，避免普通用户请求产生写操作（seed 由 /api/sidebar-config 负责）。
  const sidebarConfigRow = await prisma.systemConfig.findUnique({
    where:  { key: SIDEBAR_CONFIG_KEY },
    select: { value: true },
  });
  const sidebarConfig = parseSidebarConfig(sidebarConfigRow?.value);
  const isReadOnly = isReadOnlyAccount(sidebarConfig, session.user.email);

  return (
    <div className="flex h-full">
      <Sidebar
        userName={session.user.name ?? undefined}
        userRole={session.user.role}
        userEmail={session.user.email ?? undefined}
        userAvatar={session.user.image ?? undefined}
        departmentId={session.user.departmentId ?? undefined}
        grantedModuleKeys={grantedModuleKeys}
        hasPartyModuleAccess={hasPartyModuleAccess}
        feishuAuthorizedModules={feishuAuthorizedModules}
        sidebarConfig={sidebarConfig}
      />
      {/*
        主内容区：data-readonly 标志当前账号是否处于"只读演示模式"。
        CSS 选择器 [data-readonly="true"] 会把所有表单输入框 / 提交按钮灰化。
        ReadOnlyEnforcer 在客户端进一步给 input 加 readonly、拦截 form submit。
        退出登录、折叠按钮等必要交互通过 data-allow-readonly 例外豁免。
      */}
      <div
        className="flex-1 flex flex-col min-w-0 overflow-hidden"
        data-readonly={isReadOnly ? "true" : "false"}
        data-readonly-email={session.user.email ?? ""}
      >
        <MobileTopBar />
        <ReadOnlyEnforcer enabled={isReadOnly} email={session.user.email} />
        {children}
      </div>
    </div>
  );
}
