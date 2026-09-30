import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";

export default async function Home() {
  const session = await getSession();
  if (session) {
    // Already logged in — go straight to the right dashboard
    redirect(
      session.user.role === UserRole.DEPT_CONTACT
        ? "/dashboard/my-tasks"
        : "/dashboard/tasks"
    );
  }
  redirect("/login");
}
