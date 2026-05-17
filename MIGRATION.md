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

## 已包含数据
- 当前 SQLite(sql.js) 数据库已包含：`server/data/app.db`
- 如有上传附件，已包含：`server/uploads/`

## 注意
- 未包含 `node_modules`，请在新电脑重新执行 `npm install`。
- 未包含 `.git`、日志文件、npm 缓存和数据库备份目录。
- 数据库已加保护逻辑：已有 `server/data/app.db` 时，后端启动不会自动迁移、种子同步或覆盖数据库文件。
