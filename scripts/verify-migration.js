// 验证迁移结果：对比 Supabase 和华为云 RDS 的数据
const { Pool } = require('pg');

const supabaseUrl = 'postgresql://postgres.qlhdngijrruohbnlsnva:Gkj020709%21...@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';
const huaweiUrl = 'postgresql://root:LPAPgSQLProdP%40ss%211%23%25@10.10.0.244:5432/pa_platform';

const supabasePool = new Pool({ connectionString: supabaseUrl, connectionTimeoutMillis: 10000 });
const huaweiPool = new Pool({ connectionString: huaweiUrl, connectionTimeoutMillis: 10000 });

async function getTableCounts(pool, label) {
  const tables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  
  const results = [];
  let totalRows = 0;
  
  for (const { table_name } of tables.rows) {
    try {
      const count = await pool.query(`SELECT COUNT(*) FROM "${table_name}"`);
      const n = parseInt(count.rows[0].count);
      totalRows += n;
      results.push({ table: table_name, rows: n });
    } catch (e) {
      results.push({ table: table_name, rows: 'ERROR: ' + e.message });
    }
  }
  
  return { label, tables: results, totalRows };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  数据迁移验证报告');
  console.log('  Supabase (日本) → 华为云 RDS (内网 10.10.0.244)');
  console.log('═'.repeat(70));
  console.log();

  // 连接 Supabase
  console.log('⏳ 正在连接 Supabase（日本）...');
  const sb = await getTableCounts(supabasePool, 'Supabase');
  console.log(`✅ Supabase 连接成功，共 ${sb.tables.length} 张表，${sb.totalRows} 行数据`);
  console.log();

  // 连接华为云
  console.log('⏳ 正在连接华为云 RDS...');
  const hw = await getTableCounts(huaweiPool, '华为云 RDS');
  console.log(`✅ 华为云连接成功，共 ${hw.tables.length} 张表，${hw.totalRows} 行数据`);
  console.log();

  // 逐表对比
  console.log('─'.repeat(70));
  console.log('  逐表对比');
  console.log('─'.repeat(70));
  console.log();
  console.log('  表名'.padEnd(45) + 'Supabase'.padStart(10) + '华为云'.padStart(10) + '状态'.padStart(8));
  console.log('─'.repeat(70));

  let allMatch = true;
  let matchCount = 0;
  let mismatchCount = 0;

  for (const s of sb.tables) {
    const h = hw.tables.find(t => t.table === s.table);
    const hRows = h ? h.rows : '不存在';
    const match = String(s.rows) === String(hRows);
    
    if (!match) allMatch = false;
    
    const status = match ? '✅' : '❌';
    if (match) matchCount++; else mismatchCount++;
    
    const tableName = s.table.length > 43 ? s.table.substring(0, 40) + '...' : s.table;
    console.log(`  ${tableName.padEnd(45)}${String(s.rows).padStart(10)}${String(hRows).padStart(10)}${status.padStart(8)}`);
  }

  console.log('─'.repeat(70));
  console.log();
  console.log('  汇总:');
  console.log(`    总表数:   ${sb.tables.length}`);
  console.log(`    总行数:   Supabase=${sb.totalRows}  华为云=${hw.totalRows}`);
  console.log(`    匹配:     ${matchCount} 张表 ✅`);
  console.log(`    不匹配:   ${mismatchCount} 张表 ${mismatchCount > 0 ? '❌' : ''}`);
  console.log();

  // 抽查几张关键表的数据
  console.log('─'.repeat(70));
  console.log('  关键表数据抽查');
  console.log('─'.repeat(70));

  const keyTables = ['users', 'receptions', 'major_projects', 'meeting_minutes', 'documents'];
  
  for (const tableName of keyTables) {
    const sTable = sb.tables.find(t => t.table === tableName);
    if (!sTable || sTable.rows === 0) continue;
    
    try {
      const sample = await supabasePool.query(`SELECT * FROM "${tableName}" LIMIT 2`);
      const sampleHw = await huaweiPool.query(`SELECT * FROM "${tableName}" LIMIT 2`);
      
      console.log();
      console.log(`  📋 ${tableName} (${sTable.rows} 行)`);
      
      for (let i = 0; i < sample.rows.length; i++) {
        const sRow = sample.rows[i];
        const hRow = sampleHw.rows[i];
        
        // 对比第一列（通常是 id）和第二列（通常是名称）
        const sKeys = Object.keys(sRow);
        const hKeys = Object.keys(hRow);
        
        const firstKey = sKeys[0];
        const secondKey = sKeys[1] || sKeys[0];
        
        const sVal1 = sRow[firstKey];
        const hVal1 = hRow[firstKey];
        const sVal2 = sRow[secondKey];
        const hVal2 = hRow[secondKey];
        
        const match1 = String(sVal1) === String(hVal1);
        const match2 = String(sVal2) === String(hVal2);
        
        console.log(`    行${i+1}: ${firstKey}=${sVal1} ${match1 ? '✅' : '❌'}  ${secondKey}=${sVal2} ${match2 ? '✅' : '❌'}`);
      }
    } catch (e) {
      console.log(`  ⚠️  ${tableName} 抽查失败: ${e.message}`);
    }
  }

  console.log();
  console.log('═'.repeat(70));
  if (allMatch && sb.totalRows === hw.totalRows) {
    console.log('  ✅ 结论：数据迁移完全成功！Supabase 和华为云数据一致。');
  } else {
    console.log('  ⚠️  结论：存在差异，请检查上面标记 ❌ 的表。');
  }
  console.log('═'.repeat(70));

  await supabasePool.end();
  await huaweiPool.end();
}

main().catch(err => {
  console.error('❌ 验证失败:', err.message);
  process.exit(1);
});
