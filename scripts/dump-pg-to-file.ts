// scripts/dump-pg-to-file.ts
//
// 把本地 PG 数据库导出为可执行的 SQL 脚本（用 pg_dump）。
// 用法：node ./node_modules/tsx/dist/cli.mjs --env-file=.env scripts/dump-pg-to-file.ts [out.sql]
//
// 该脚本**不**自己实现 dump，只是封装 pg_dump 命令并自动推断连接参数。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const PGDUMP_PATHS = [
  "C:\\Users\\admin\\pg-extract\\pgsql\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe",
  "/usr/bin/pg_dump",
  "/usr/local/bin/pg_dump",
  "/opt/homebrew/bin/pg_dump",
];

function findPgDump(): string {
  for (const p of PGDUMP_PATHS) {
    if (existsSync(p)) return p;
  }
  // 最后尝试 PATH
  return "pg_dump";
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
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL not set. Use --env-file=.env");
    process.exit(1);
  }

  const outFile = process.argv[2] ?? `pg-dump-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
  const pgdump = findPgDump();
  const { host, port, user, password, db } = parseDatabaseUrl(url);

  console.log(`> pg_dump binary: ${pgdump}`);
  console.log(`> connecting to:  ${user}@${host}:${port}/${db}`);
  console.log(`> writing to:     ${outFile}`);

  const args = [
    "-h", host,
    "-p", port,
    "-U", user,
    "-d", db,
    "--no-owner",            // Vercel / Neon 用自己账号
    "--no-privileges",       // 同上
    "--clean-if-exist",      // 目标库已有表时先 DROP
    "--if-exists",
    "-Fc",                   // custom format（压缩、二进制）
    "-f", outFile,
  ];

  try {
    execFileSync(pgdump, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PGPASSWORD: password },
    });
    console.log(`\n✓ Dump complete: ${path.resolve(outFile)}`);
    console.log("\nNext step:");
    console.log(`  scripts/restore-pg-from-file.ts ${outFile}`);
  } catch (e: any) {
    console.error(`\n✗ pg_dump failed: ${e.message}`);
    console.error("\nFallback: 手动用 psql 命令导出 / 导入");
    console.error(`  psql "${url}" -c "\\copy (SELECT * FROM users) TO 'users.csv' CSV HEADER"`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
