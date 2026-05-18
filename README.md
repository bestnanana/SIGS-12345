# SIGS接诉即办 - SIGS Prompt Complaint

React 18 + Tailwind CSS 3 + Node.js + Express + SQLite(sql.js) + Minimax API 的校园诉求办理演示系统。

## 启动

```bash
npm install --cache ./.npm-cache
npm run dev
```

Windows PowerShell 如遇到 `npm.ps1` 执行策略限制，可使用：

```bash
npm.cmd run dev
```

前端地址：http://localhost:5173
后端地址：http://localhost:3001

开发模式下前端统一请求 `/api` 和 `/uploads`，Vite 会自动代理到 `http://localhost:3001`。如需调整后端地址，可在启动前设置 `API_TARGET`。

## 演示账号

- 学生用户：`student` / `123456`
- 超级管理员：`super_admin` / `123456`
- 张明（党政办，1级管理员）：`admin` / `123456`
- 李晨（信数中心，2级管理员）：`admin2` / `123456`
- 周宁（信数中心，2级管理员）：`xszx_admin` / `123456`
- 王芳（学工办，2级管理员）：`xgb_admin` / `123456`
- 陈静（培养处，2级管理员）：`pyc_admin` / `123456`
- 赵磊（财务办，2级管理员）：`cwb_admin` / `123456`
- 刘洋（人事办，2级管理员）：`rsb_admin` / `123456`

## Minimax 配置

复制 `.env.example` 为 `.env`，填写：

```env
MINIMAX_API_KEY=你的API_KEY
MINIMAX_GROUP_ID=你的GROUP_ID
MINIMAX_MODEL=abab6.5s-chat
```

未配置 Minimax 时，系统会自动使用本地规则生成事项分类和回复建议，保证完整流程可运行。

## 主要功能

- JWT 登录认证与用户角色区分
- 接诉即办表单：使用须知、标题、领域、单位联动、内容、附件、匿名提交
- 接诉即办表单：使用须知、标题、领域、部门单选、内容、附件、匿名提交
- 我的事项：编号、标题、提交时间、状态、详情
- 事项详情：提交内容、附件预览、官方回复、官方附件、点赞/点踩/收藏
- 后台管理：部门事项队列、状态更新、转办、使用智能建议快速回复、上传官方附件
- 典型问题发布：管理员可将事项发布到公开展示页
- SQLite 文件持久化：`server/data/app.db`
