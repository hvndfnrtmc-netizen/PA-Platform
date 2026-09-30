/**
 * 每晚 19:00 自动备份脚本
 * 运行方式：npm run backup:start（保持终端开启）
 */

const cron = require("node-cron");
const { execSync } = require("child_process");
const path = require("path");

const PROJECT_DIR = __dirname;

function runGitBackup() {
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  console.log(`[${now}] 开始执行自动备份...`);
  try {
    execSync("git add .", { cwd: PROJECT_DIR, stdio: "inherit" });
    execSync('git commit -m "chore: nightly auto backup"', {
      cwd: PROJECT_DIR,
      stdio: "inherit",
    });
    execSync("git push", { cwd: PROJECT_DIR, stdio: "inherit" });
    const done = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    console.log(`[${done}] 自动备份成功。`);
  } catch (err) {
    const errTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    // git commit 在无变更时会报错退出，这属于正常情况
    if (err.message && err.message.includes("nothing to commit")) {
      console.log(`[${errTime}] 无变更，跳过本次备份。`);
    } else {
      console.error(`[${errTime}] 备份失败：`, err.message);
    }
  }
}

// 每天 19:00 执行（上海时区）
cron.schedule(
  "0 19 * * *",
  () => {
    runGitBackup();
  },
  {
    timezone: "Asia/Shanghai",
  }
);

console.log("定时备份程序已启动，将在每天 19:00 自动执行 git backup。");
console.log("请保持此终端窗口开启，关闭后定时任务将停止。");
