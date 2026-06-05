# SIGS 项目迁移运行说明

## 运行环境
- Node.js 18 或更高版本
- Windows/macOS/Linux 均可

## 启动步骤
1. 解压本压缩包。
2. 在项目根目录执行：`npm install --cache ./.npm-cache`
3. 启动开发服务：`npm run dev`
4. 前端地址：`http://localhost:5173`
5. 后端地址：`http://localhost:3001`

## 数据库说明
- 系统已统一使用远程 MySQL：`219.223.170.14:3306/response_test`
- 后端数据库访问统一从 `server/db_mysql.js` 进入。
- 部署包不再包含本地 SQLite/sql.js 数据库文件。
- 如有上传附件，仍使用：`server/uploads/`

## 注意
- 未包含 `node_modules`，请在新电脑重新执行 `npm install`。
- 未包含 `.git`、日志文件、npm 缓存和数据库备份目录。
- 请通过 `.env` 配置 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`，不要恢复本地 SQLite/sql.js 数据库路径。
