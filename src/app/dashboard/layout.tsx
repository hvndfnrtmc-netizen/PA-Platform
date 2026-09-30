import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import prisma from "@/lib/prisma";

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

  return (
    <div className="flex h-full">
      <Sidebar
        userName={session.user.name ?? undefined}
        userRole={session.user.role}
        userAvatar={session.user.image ?? undefined}
        departmentId={session.user.departmentId ?? undefined}
        grantedModuleKeys={grantedModuleKeys}
        hasPartyModuleAccess={hasPartyModuleAccess}
        feishuAuthorizedModules={feishuAuthorizedModules}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <MobileTopBar />
        {children}
      </div>
    </div>
  );
}
