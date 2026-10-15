// One-shot DB inspection: list all users, their roles, party flags,
// party module permissions, and sidebar-config state. Read-only.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const main = async () => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      department: true,
      isActive: true,
      hasPartyModuleAccess: true,
      hasPartyAdminAccess: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("=== USER ACCOUNTS ===");
  console.log(["email", "name", "role", "active", "partyMod", "partyAdm"].join("\t"));
  for (const u of users) {
    console.log(
      [
        u.email,
        u.name || "",
        u.role,
        u.isActive ? "Y" : "N",
        u.hasPartyModuleAccess ? "Y" : "N",
        u.hasPartyAdminAccess ? "Y" : "N",
      ].join("\t"),
    );
  }

  const cfg = await prisma.systemConfig.findFirst({
    where: { key: "sidebar_menu_config" },
  });
  console.log("\n=== SIDEBAR CONFIG (key=sidebar_menu_config) ===");
  console.log("exists:", !!cfg);
  if (cfg) {
    const parsed = JSON.parse(cfg.value);
    console.log(
      "global hidden count:",
      parsed.global ? Object.values(parsed.global).filter((v) => v === false).length : 0,
      "/",
      parsed.global ? Object.keys(parsed.global).length : 0,
    );
    console.log(
      "accountWhitelist emails:",
      parsed.accountWhitelist ? Object.keys(parsed.accountWhitelist) : [],
    );
    console.log(
      "roleScope roles:",
      parsed.roleScope ? Object.keys(parsed.roleScope) : [],
    );
  }

  // Sanity: confirm SUPER_ADMIN user still has full party access
  const su = users.find((u) => u.role === "SUPER_ADMIN");
  console.log("\n=== SUPER_ADMIN PRESERVED CHECK ===");
  console.log("SUPER_ADMIN email:", su?.email);
  console.log("SUPER_ADMIN active:", su?.isActive);
  console.log("SUPER_ADMIN hasPartyModuleAccess:", su?.hasPartyModuleAccess);
  console.log("SUPER_ADMIN hasPartyAdminAccess:", su?.hasPartyAdminAccess);
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
