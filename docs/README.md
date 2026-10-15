# 部署文档索引

本目录包含把 PA-Platform 部署到生产环境所需的全部文档。

## 文档列表（按阅读顺序）

| # | 文档 | 何时读 |
|---|---|---|
| 1 | **[DEPLOY_TO_VERCEL.md](./DEPLOY_TO_VERCEL.md)** | 第一次部署时从头到尾读完 |
| 2 | **[SECRET_ROTATION.md](./SECRET_ROTATION.md)** | 填 Vercel 环境变量时配合读 |
| 3 | **[STORAGE_ON_VERCEL.md](./STORAGE_ON_VERCEL.md)** | 部署成功后想用文档上传功能时读 |
| 4 | **[FEISHU_WORKBENCH.md](./FEISHU_WORKBENCH.md)** | 想把 PA-Platform 装到飞书侧边栏时读 |
| 5 | **[FEISHU_SSO.md](./FEISHU_SSO.md)** | 想让飞书用户扫码登录时读 |

## 部署脚本

- `scripts/dump-pg-to-file.ts` — 把本地 PG 导出为 SQL
- `scripts/restore-pg-from-file.ts` — 把 SQL 恢复到远程 PG（Neon）

## 部署相关代码

- `vercel.json` — Vercel 构建配置（hkg1 区域 + cron 任务 + 函数超时）
- `.vercelignore` — 部署时排除的本地文件（文档、迁移脚本等）
- `.env.example` — 生产环境变量模板（无密钥）
