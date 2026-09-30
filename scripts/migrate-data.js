/**
 * 步骤3：数据迁移 — 从 Supabase 复制全部数据到华为云 RDS
 *
 * 原理：
 *   1. 连接源库 (Supabase) 和目标库 (华为云 RDS)
 *   2. 目标库关闭外键检查 (session_replication_role = replica)
 *   3. 逐表 SELECT * → INSERT
 *   4. 恢复外键检查
 *   5. 打印对比报告
 *
 * 运行方式: node scripts/migrate-data.js
 */

const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const BATCH_SIZE = 100;

const source = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
});

const target = new Client({
  host: "10.10.0.244",
  port: 5432,
  user: "root",
  password: "LPAPgSQLProdP@ss!1#%",
  database: "pa_platform",
  connectionTimeoutMillis: 30000,
});

async function main() {
  console.log("====================================");
  console.log("数据迁移：Supabase → 华为云 RDS");
  console.log("====================================\n");

  await source.connect();
  await target.connect();
  console.log("✅ 两个数据库均已连接\n");

  // 获取所有表名
  const tables = await source.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log(`共 ${tables.rows.length} 张表需要迁移\n`);

  // 关闭目标库外键/触发器检查
  await target.query("SET session_replication_role = 'replica'");
  console.log("✅ 目标库外键检查已关闭\n");

  let totalRows = 0;
  let migratedTables = 0;
  const report = [];

  for (const { tablename } of tables.rows) {
    // 获取列名和类型
    const cols = await source.query(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tablename]
    );
    const columnNames = cols.rows.map((r) => r.column_name);
    // 标记 JSON/JSONB 列，插入时需要 JSON.stringify
    const jsonColumns = new Set(
      cols.rows
        .filter((r) => r.data_type === "jsonb" || r.data_type === "json" || r.udt_name === "_json" || r.udt_name === "_jsonb")
        .map((r) => r.column_name)
    );

    // 源表行数
    const countRes = await source.query(`SELECT count(*) FROM "${tablename}"`);
    const sourceCount = parseInt(countRes.rows[0].count);

    if (sourceCount === 0) {
      console.log(`⏭️  ${tablename}: 0 行，跳过`);
      report.push({ table: tablename, source: 0, target: 0, status: "empty" });
      continue;
    }

    // 清空目标表
    await target.query(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE`);

    // 分批读取并插入
    const colList = columnNames.map((c) => `"${c}"`).join(", ");
    let inserted = 0;

    // 一次性读取所有数据（对于内部系统，数据量通常不大）
    const data = await source.query(`SELECT * FROM "${tablename}"`);
    const rows = data.rows;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = batch
        .map((_, rowIdx) => {
          const rowParams = columnNames
            .map((_, colIdx) => {
              const paramIdx = rowIdx * columnNames.length + colIdx + 1;
              return `$${paramIdx}`;
            })
            .join(", ");
          return `(${rowParams})`;
        })
        .join(", ");

      for (const row of batch) {
        for (const col of columnNames) {
          let val = row[col];
          if (val === undefined) {
            val = null;
          } else if (jsonColumns.has(col) && val !== null) {
            // JSONB 列：pg 读取时自动解析为 JS 对象，插入时需转回字符串
            val = typeof val === "string" ? val : JSON.stringify(val);
          }
          values.push(val);
        }
      }

      await target.query(
        `INSERT INTO "${tablename}" (${colList}) VALUES ${placeholders}`,
        values
      );
      inserted += batch.length;
    }

    // 验证目标表行数
    const targetCountRes = await target.query(`SELECT count(*) FROM "${tablename}"`);
    const targetCount = parseInt(targetCountRes.rows[0].count);

    const status = targetCount === sourceCount ? "✅" : "❌";
    console.log(`${status} ${tablename}: ${sourceCount} 行 → ${targetCount} 行`);

    totalRows += sourceCount;
    migratedTables++;
    report.push({ table: tablename, source: sourceCount, target: targetCount, status: targetCount === sourceCount ? "ok" : "MISMATCH" });
  }

  // 重置序列
  console.log("\n── 重置序列 ──");
  const seqRes = await target.query(
    `SELECT relname as seq_name FROM pg_class WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace`
  );
  for (const { seq_name } of seqRes.rows) {
    try {
      await target.query(`SELECT setval('"${seq_name}"', GREATEST(1, (SELECT max_val FROM (SELECT max(id) as max_val FROM "${seq_name.replace(/_id_seq$/, "")}") sub)))`);
    } catch {
      // 某些序列关联的表可能不存在，跳过
    }
  }
  console.log(`✅ 序列已重置 (${seqRes.rows.length} 个)`);

  // 恢复外键检查
  await target.query("SET session_replication_role = 'origin'");
  console.log("✅ 目标库外键检查已恢复\n");

  // 打印汇总
  console.log("====================================");
  console.log("迁移汇总");
  console.log("====================================");
  console.log(`迁移表数: ${migratedTables} / ${tables.rows.length}`);
  console.log(`迁移行数: ${totalRows} 行`);

  const mismatches = report.filter((r) => r.status === "MISMATCH");
  if (mismatches.length === 0) {
    console.log("\n🎉 全部迁移成功！行数完全匹配。");
  } else {
    console.log(`\n⚠️  ${mismatches.length} 张表行数不匹配：`);
    mismatches.forEach((m) => console.log(`  - ${m.table}: ${m.source} → ${m.target}`));
  }

  await source.end();
  await target.end();
}

main().catch((err) => {
  console.error("\n❌ 迁移失败:", err.message);
  console.error(err.stack);
  process.exit(1);
});
