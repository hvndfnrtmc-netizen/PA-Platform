/**
 * 数据库连通性测试 — 测试 Supabase 和华为云 RDS 是否能连上
 * 运行方式: node scripts/test-connection.js
 */

const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

async function testSupabase() {
  console.log("\n── 测试 Supabase 连接（日本）──");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    const res = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("✅ Supabase 连接成功！表数量:", res.rows[0].count);
    const tableRes = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    console.log("表列表:", tableRes.rows.map(r => r.tablename).join(", "));
    return true;
  } catch (err) {
    console.error("❌ Supabase 连接失败:", err.message);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function testHuaweiRDS() {
  console.log("\n── 测试华为云 RDS 连接（内网 10.10.0.244）──");
  const client = new Client({
    host: "10.10.0.244",
    port: 5432,
    user: "root",
    password: "LPAPgSQLProdP@ss!1#%",
    database: "postgres",
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    const res = await client.query("SELECT version()");
    console.log("✅ 华为云 RDS 连接成功！");
    console.log("数据库版本:", res.rows[0].version.split(",")[0]);

    const dbRes = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
    console.log("已有数据库:", dbRes.rows.map(r => r.datname).join(", "));
    return true;
  } catch (err) {
    console.error("❌ 华为云 RDS 连接失败:", err.message);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  console.log("====================================");
  console.log("数据库连通性测试");
  console.log("====================================");

  const supaOk = await testSupabase();
  const hwOk = await testHuaweiRDS();

  console.log("\n── 测试结果汇总 ──");
  console.log("Supabase:", supaOk ? "✅ 可连接" : "❌ 不可连接");
  console.log("华为云 RDS:", hwOk ? "✅ 可连接" : "❌ 不可连接");

  if (supaOk && hwOk) {
    console.log("\n🎉 两个数据库都能连上！可以开始迁移。");
  } else {
    console.log("\n⚠️ 有数据库连不上，请检查网络/VPN/密码。");
  }
}

main().catch(console.error);
