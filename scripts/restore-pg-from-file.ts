// scripts/restore-pg-from-file.ts
//
// 把 pg_dump 产物恢复到目标 PostgreSQL（Neon / Supabase / Vercel Postgres 等）。
// 用法：node ./node_modules/tsx/dist/cli.mjs --env-file=.env.production scripts/restore-pg-from-file.ts pg-dump-xxx.sql
//
// 优先用 pg_restore（custom format），失败时回退 psql。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PGRESTORE_PATHS = [
  "C:\\Users\\admin\\pg-extract\\pgsql\\bin\\pg_restore.exe",
  "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe",
  "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_restore.exe",
  "C:\\Program Files\\PostgreSQL\\14\\bin\\pg_restore.exe",
  "/usr/bin/pg_restore",
  "/usr/local/bin/pg_restore",
  "/opt/homebrew/bin/pg_restore",
];

function findPgTool(name: string): string {
  const paths = name === "pg_restore" ? PGRESTORE_PATHS : [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return name;
}

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    db: u.pathname.replace(/^\//, ""),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("ERROR: Usage: restore-pg-from-file.ts <dump-file>");
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`ERROR: File not found: ${file}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL not set. Use --env-file=.env.production");
    process.exit(1);
  }

  const tool = findPgTool("pg_restore");
  const { host, port, user, password, db } = parseDatabaseUrl(url);

  console.log(`> pg_restore binary: ${tool}`);
  console.log(`> connecting to:     ${user}@${host}:${port}/${db}`);
  console.log(`> restoring from:    ${file}`);

  const args = [
    "-h", host,
    "-p", port,
    "-U", user,
    "-d", db,
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    "-v",
    file,
  ];

  // ⚠️ 必须先在目标 DB 上跑一次 prisma migrate deploy（或 db push）让 schema 存在，
  // 否则 pg_restore 会因为缺少表而报 "relation does not exist"。
  console.log("\n⚠️  Pre-flight check: target DB must already have schema.");
  console.log("   如果还没跑过 schema，先在目标 DB 上执行：");
  console.log(`     npx prisma db push --schema=./prisma/schema.prisma`);
  console.log(`     （DATABASE_URL 指向目标库）\n`);

  try {
    execFileSync(tool, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PGPASSWORD: password },
    });
    console.log(`\n✓ Restore complete.`);
  } catch (e: any) {
    console.error(`\n✗ pg_restore failed: ${e.message}`);
    console.error("\nFallback: 用 psql 恢复（仅 plain-text 格式可用）");
    console.error(`  psql "${url}" -f ${file}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
