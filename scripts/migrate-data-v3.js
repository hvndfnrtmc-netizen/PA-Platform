/**
 * 数据迁移 v3 — 修复事务提交问题
 * 
 * 关键修复：
 *   1. 每张表用显式 BEGIN/COMMIT 包裹
 *   2. 去掉 session_replication_role（改用 SET CONSTRAINTS DEFERRED）
 *   3. 用 DELETE FROM 替代 TRUNCATE（更安全）
 *   4. 插入后用新连接验证（防止读到同事务快照）
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

// 类型预处理
function preprocessValue(val, dataType, udtName) {
  if (val === undefined) return null;
  if (val === null) return null;
  if (dataType === "jsonb" || dataType === "json") {
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return val;
}

async function main() {
  console.log("====================================");
  console.log("数据迁移 v3：Supabase → 华为云 RDS");
  console.log("(显式事务 + 新连接验证)");
  console.log("====================================\n");

  const source = new Client(sourceConfig);
  await source.connect();
  console.log("✅ Supabase 已连接");

  // 先获取所有表信息
  const tables = await source.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log(`共 ${tables.rows.length} 张表\n`);

  let totalRows = 0;
  let okCount = 0;
  let failCount = 0;

  for (const { tablename } of tables.rows) {
    // 源表行数
    const countRes = await source.query(`SELECT count(*) FROM "${tablename}"`);
    const sourceCount = parseInt(countRes.rows[0].count);

    if (sourceCount === 0) {
      console.log(`⏭️  ${tablename}: 0 行，跳过`);
      continue;
    }

    try {
      // 获取列信息
      const cols = await source.query(
        `SELECT column_name, data_type, udt_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [tablename]
      );
      const columnNames = cols.rows.map((r) => r.column_name);
      const colTypes = {};
      cols.rows.forEach((r) => {
        colTypes[r.column_name] = { data_type: r.data_type, udt_name: r.udt_name };
      });

      // 读取源数据
      const data = await source.query(`SELECT * FROM "${tablename}"`);
      const rows = data.rows;

      // 用独立连接写入（确保每个表的事务完全独立）
      const writer = new Client(targetConfig);
      await writer.connect();

      // 显式事务
      await writer.query("BEGIN");
      
      // 关闭外键检查
      await writer.query("SET CONSTRAINTS ALL DEFERRED");

      // 清空目标表（用 DELETE，不重启序列）
      await writer.query(`DELETE FROM "${tablename}"`);

      // 分批插入
      const colList = columnNames.map((c) => `"${c}"`).join(", ");

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
            const typeInfo = colTypes[col];
            values.push(
              preprocessValue(row[col], typeInfo.data_type, typeInfo.udt_name)
            );
          }
        }

        await writer.query(
          `INSERT INTO "${tablename}" (${colList}) VALUES ${placeholders}`,
          values
        );
      }

      // 提交事务
      await writer.query("COMMIT");
      await writer.end();

      // 用新连接验证（避免读到同事务快照）
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
      console.log(`❌ ${tablename}: ${err.message}`);
      if (err.detail) console.log(`   详情: ${err.detail}`);
      failCount++;
    }
  }

  // 重置序列
  console.log("\n── 重置序列 ──");
  const seqFixer = new Client(targetConfig);
  await seqFixer.connect();
  const seqRes = await seqFixer.query(
    `SELECT relname as seq_name FROM pg_class WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace`
  );
  let seqFixed = 0;
  for (const { seq_name } of seqRes.rows) {
    try {
      const tableName = seq_name.replace(/_id_seq$/, "");
      await seqFixer.query(
        `SELECT setval('"${seq_name}"', GREATEST(1, (SELECT COALESCE(max(id), 1) FROM "${tableName}")))`
      );
      seqFixed++;
    } catch {
      // 跳过
    }
  }
  console.log(`✅ 重置了 ${seqFixed}/${seqRes.rows.length} 个序列`);
  await seqFixer.end();

  await source.end();

  // 汇总
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
  console.error(err.stack);
  process.exit(1);
});
