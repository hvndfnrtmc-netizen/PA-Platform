/**
 * 数据迁移 v4 — 最终修复版
 * 
 * 策略：SET session_replication_role = 'replica' 关闭所有触发器（含外键）
 *       + 每张表显式 BEGIN/COMMIT 确保数据持久化
 *       + 新连接验证
 */

const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const BATCH_SIZE = 100;

const sourceConfig = {
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
};

const targetConfig = {
  host: "10.10.0.244",
  port: 5432,
  user: "root",
  password: "LPAPgSQLProdP@ss!1#%",
  database: "pa_platform",
  connectionTimeoutMillis: 30000,
};

function preprocessValue(val, dataType) {
  if (val === undefined || val === null) return null;
  if (dataType === "jsonb" || dataType === "json") {
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return val;
}

async function main() {
  console.log("====================================");
  console.log("数据迁移 v4：Supabase → 华为云 RDS");
  console.log("(session_replica + 显式事务 + 新连接验证)");
  console.log("====================================\n");

  const source = new Client(sourceConfig);
  await source.connect();
  console.log("✅ Supabase 已连接");

  // 目标库：设置 replica 角色（关闭所有触发器和外键检查）
  const target = new Client(targetConfig);
  await target.connect();
  console.log("✅ 华为云 RDS 已连接");
  await target.query("SET session_replication_role = 'replica'");
  console.log("✅ 外键检查已关闭（replica 模式）\n");

  const tables = await source.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log(`共 ${tables.rows.length} 张表\n`);

  let totalRows = 0;
  let okCount = 0;
  let failCount = 0;

  for (const { tablename } of tables.rows) {
    const countRes = await source.query(`SELECT count(*) FROM "${tablename}"`);
    const sourceCount = parseInt(countRes.rows[0].count);

    if (sourceCount === 0) {
      console.log(`⏭️  ${tablename}: 0 行，跳过`);
      continue;
    }

    try {
      const cols = await source.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [tablename]
      );
      const columnNames = cols.rows.map((r) => r.column_name);
      const colTypes = {};
      cols.rows.forEach((r) => { colTypes[r.column_name] = r.data_type; });

      const data = await source.query(`SELECT * FROM "${tablename}"`);
      const rows = data.rows;

      // 显式事务
      await target.query("BEGIN");
      await target.query(`DELETE FROM "${tablename}"`);

      const colList = columnNames.map((c) => `"${c}"`).join(", ");

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const values = [];
        const placeholders = batch
          .map((_, rowIdx) => {
            const rowParams = columnNames
              .map((_, colIdx) => `$${rowIdx * columnNames.length + colIdx + 1}`)
              .join(", ");
            return `(${rowParams})`;
          })
          .join(", ");

        for (const row of batch) {
          for (const col of columnNames) {
            values.push(preprocessValue(row[col], colTypes[col]));
          }
        }

        await target.query(
          `INSERT INTO "${tablename}" (${colList}) VALUES ${placeholders}`,
          values
        );
      }

      // 显式提交
      await target.query("COMMIT");

      // 新连接验证
      const verifier = new Client(targetConfig);
      await verifier.connect();
      const targetCountRes = await verifier.query(`SELECT count(*) FROM "${tablename}"`);
      const targetCount = parseInt(targetCountRes.rows[0].count);
      await verifier.end();

      const icon = targetCount === sourceCount ? "✅" : "❌";
      console.log(`${icon} ${tablename}: ${sourceCount} 行 → ${targetCount} 行`);

      if (targetCount === sourceCount) {
        okCount++;
        totalRows += sourceCount;
      } else {
        failCount++;
      }
    } catch (err) {
      // 回滚当前表
      try { await target.query("ROLLBACK"); } catch {}
      console.log(`❌ ${tablename}: ${err.message}`);
      failCount++;
    }
  }

  // 恢复
  await target.query("SET session_replication_role = 'origin'");
  console.log("\n✅ 外键检查已恢复（origin 模式）");

  // 重置序列
  const seqRes = await target.query(
    `SELECT relname as seq_name FROM pg_class WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace`
  );
  let seqFixed = 0;
  for (const { seq_name } of seqRes.rows) {
    try {
      const tableName = seq_name.replace(/_id_seq$/, "");
      await target.query(
        `SELECT setval('"${seq_name}"', GREATEST(1, (SELECT COALESCE(max(id), 1) FROM "${tableName}")))`
      );
      seqFixed++;
    } catch {}
  }
  console.log(`✅ 重置了 ${seqFixed}/${seqRes.rows.length} 个序列`);

  await target.end();
  await source.end();

  console.log("\n====================================");
  console.log("迁移汇总");
  console.log("====================================");
  console.log(`成功: ${okCount} 张表`);
  console.log(`失败: ${failCount} 张表`);
  console.log(`总行数: ${totalRows} 行`);
  if (failCount === 0) {
    console.log("\n🎉 全部迁移成功！");
  }
}

main().catch((err) => {
  console.error("\n❌ 迁移失败:", err.message);
  process.exit(1);
});
