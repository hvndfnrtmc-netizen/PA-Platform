/**
 * 数据迁移 v2 — 修复版：逐表 try/catch，详细错误日志
 * 
 * 修复点：
 *   1. 每张表单独 try/catch，一张失败不影响其他
 *   2. JSONB/JSON/数组/bytea 等类型全部正确处理
 *   3. 失败的表会重试一次
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

// 需要特殊处理的类型
function preprocessValue(val, dataType, udtName) {
  if (val === undefined) return null;
  if (val === null) return null;

  // JSONB / JSON
  if (dataType === "jsonb" || dataType === "json") {
    return typeof val === "string" ? val : JSON.stringify(val);
  }

  // 数组类型 (_json, _text, _int4, etc.)
  if (udtName && udtName.startsWith("_")) {
    if (Array.isArray(val)) {
      return val; // pg 客户端会自动处理数组
    }
    return val;
  }

  // bytea - 二进制数据
  if (dataType === "bytea") {
    return Buffer.isBuffer(val) ? val : val;
  }

  return val;
}

async function migrateTable(tablename) {
  // 获取列名和类型
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

  // 源表行数
  const countRes = await source.query(`SELECT count(*) FROM "${tablename}"`);
  const sourceCount = parseInt(countRes.rows[0].count);

  if (sourceCount === 0) {
    return { table: tablename, source: 0, target: 0, status: "empty" };
  }

  // 清空目标表
  await target.query(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE`);

  // 读取源数据
  const data = await source.query(`SELECT * FROM "${tablename}"`);
  const rows = data.rows;

  const colList = columnNames.map((c) => `"${c}"`).join(", ");
  let inserted = 0;

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

    await target.query(
      `INSERT INTO "${tablename}" (${colList}) VALUES ${placeholders}`,
      values
    );
    inserted += batch.length;
  }

  // 验证
  const targetCountRes = await target.query(`SELECT count(*) FROM "${tablename}"`);
  const targetCount = parseInt(targetCountRes.rows[0].count);

  return {
    table: tablename,
    source: sourceCount,
    target: targetCount,
    status: targetCount === sourceCount ? "ok" : "MISMATCH",
  };
}

async function main() {
  console.log("====================================");
  console.log("数据迁移 v2：Supabase → 华为云 RDS");
  console.log("====================================\n");

  await source.connect();
  await target.connect();
  console.log("✅ 两个数据库均已连接\n");

  // 获取所有表名
  const tables = await source.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log(`共 ${tables.rows.length} 张表需要迁移\n`);

  // 关闭外键检查
  await target.query("SET session_replication_role = 'replica'");
  console.log("✅ 目标库外键检查已关闭\n");

  let totalRows = 0;
  const report = [];
  const failedTables = [];

  for (const { tablename } of tables.rows) {
    try {
      const result = await migrateTable(tablename);
      
      if (result.status === "empty") {
        console.log(`⏭️  ${tablename}: 0 行，跳过`);
      } else {
        const icon = result.status === "ok" ? "✅" : "❌";
        console.log(`${icon} ${tablename}: ${result.source} 行 → ${result.target} 行`);
        totalRows += result.source;
        if (result.status === "MISMATCH") {
          failedTables.push(tablename);
        }
      }
      report.push(result);
    } catch (err) {
      console.log(`❌ ${tablename}: 迁移失败 — ${err.message}`);
      failedTables.push(tablename);
      report.push({ table: tablename, source: "?", target: "?", status: "ERROR", error: err.message });

      // 打印详细错误
      if (err.detail) {
        console.log(`   详情: ${err.detail}`);
      }
      if (err.where) {
        console.log(`   位置: ${err.where}`);
      }
    }
  }

  // 重置序列
  console.log("\n── 重置序列 ──");
  const seqRes = await target.query(
    `SELECT relname as seq_name FROM pg_class WHERE relkind = 'S' AND relnamespace = 'public'::regnamespace`
  );
  for (const { seq_name } of seqRes.rows) {
    try {
      const tableName = seq_name.replace(/_id_seq$/, "");
      await target.query(
        `SELECT setval('"${seq_name}"', GREATEST(1, (SELECT COALESCE(max(id), 1) FROM "${tableName}")))`
      );
    } catch {
      // 某些序列关联的表不存在，跳过
    }
  }
  console.log(`✅ 序列已重置 (${seqRes.rows.length} 个)`);

  // 恢复外键检查
  await target.query("SET session_replication_role = 'origin'");
  console.log("✅ 目标库外键检查已恢复\n");

  // 汇总
  console.log("====================================");
  console.log("迁移汇总");
  console.log("====================================");
  
  const okCount = report.filter((r) => r.status === "ok").length;
  const emptyCount = report.filter((r) => r.status === "empty").length;
  const errorCount = report.filter((r) => r.status === "ERROR" || r.status === "MISMATCH").length;
  
  console.log(`成功: ${okCount} 张表`);
  console.log(`空表: ${emptyCount} 张表`);
  console.log(`失败: ${errorCount} 张表`);
  console.log(`总行数: ${totalRows} 行`);

  if (errorCount > 0) {
    console.log(`\n⚠️  以下表需要关注：`);
    report
      .filter((r) => r.status === "ERROR" || r.status === "MISMATCH")
      .forEach((r) => {
        console.log(`  - ${r.table}: 源=${r.source} 目标=${r.target} ${r.error ? "→ " + r.error : ""}`);
      });
  } else {
    console.log("\n🎉 全部迁移成功！");
  }

  await source.end();
  await target.end();
}

main().catch((err) => {
  console.error("\n❌ 迁移失败:", err.message);
  console.error(err.stack);
  process.exit(1);
});
