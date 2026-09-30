/**
 * 步骤1：在华为云 RDS 上创建 pa_platform 数据库
 * 运行方式: node scripts/create-huawei-db.js
 */

const { Client } = require("pg");

async function main() {
  console.log("── 创建 pa_platform 数据库 ──\n");

  const admin = new Client({
    host: "10.10.0.244",
    port: 5432,
    user: "root",
    password: "LPAPgSQLProdP@ss!1#%",
    database: "postgres",
    connectionTimeoutMillis: 10000,
  });

  try {
    await admin.connect();
    console.log("✅ 已连接华为云 RDS");

    // 检查数据库是否已存在
    const checkRes = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1", ["pa_platform"]
    );

    if (checkRes.rows.length > 0) {
      console.log("⚠️  pa_platform 数据库已存在，跳过创建");
    } else {
      // 创建数据库
      await admin.query('CREATE DATABASE pa_platform');
      console.log("✅ pa_platform 数据库创建成功！");
    }

    // 验证
    const list = await admin.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    console.log("当前数据库列表:", list.rows.map(r => r.datname).join(", "));

  } catch (err) {
    console.error("❌ 失败:", err.message);
    process.exit(1);
  } finally {
    await admin.end().catch(() => {});
  }
}

main();
