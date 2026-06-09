#!/bin/bash
# 校园12345系统 Linux 部署包打包脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== 校园12345系统 Linux 部署包打包 ===${NC}"

# 获取项目根目录
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# 部署包名称
DEPLOY_NAME="campus-12345-linux-$(date +%Y%m%d_%H%M%S)"
DEPLOY_DIR="/tmp/${DEPLOY_NAME}"
ARCHIVE_NAME="${DEPLOY_NAME}.tar.gz"

echo -e "${YELLOW}1. 清理并创建部署目录...${NC}"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

echo -e "${YELLOW}2. 构建前端...${NC}"
npm run build 2>/dev/null || {
  echo "前端构建失败，使用已有的构建产物..."
  if [ -d "client/dist" ]; then
    cp -r client/dist "$DEPLOY_DIR/dist"
  elif [ -d "dist" ]; then
    cp -r dist "$DEPLOY_DIR/"
  fi
}

echo -e "${YELLOW}3. 复制必要文件...${NC}"

# 复制服务器端代码
cp -r server "$DEPLOY_DIR/"
rm -rf "$DEPLOY_DIR/server/data" "$DEPLOY_DIR/server/logs" "$DEPLOY_DIR/server/uploads"
mkdir -p "$DEPLOY_DIR/server/uploads"

# 复制前端构建产物
if [ -d "client/dist" ]; then
  cp -r client/dist "$DEPLOY_DIR/dist"
elif [ -d "dist" ]; then
  cp -r dist "$DEPLOY_DIR/"
fi

# 复制脚本
mkdir -p "$DEPLOY_DIR/scripts"
cp scripts/*.js "$DEPLOY_DIR/scripts/" 2>/dev/null || true

# 复制配置文件
cp package.json "$DEPLOY_DIR/"
cp package-lock.json "$DEPLOY_DIR/"
cp vite.config.mjs "$DEPLOY_DIR/"
cp tailwind.config.js "$DEPLOY_DIR/"
cp postcss.config.js "$DEPLOY_DIR/"

# 复制环境配置
cp .env.example "$DEPLOY_DIR/"
# 创建生产环境配置模板
cat > "$DEPLOY_DIR/.env" << 'EOF'
# 服务器配置
PORT=3001
HOST=0.0.0.0
NODE_ENV=production

# JWT 配置
JWT_SECRET=please-change-me-to-a-random-string
JWT_EXPIRES_IN=8h

# Session 配置
SESSION_COOKIE_NAME=campus.sid
SESSION_MAX_AGE_MS=28800000

# SSO 配置
SSO_AUTHORIZE_BASE_URL=https://id.sigs.tsinghua.edu.cn
SSO_API_BASE_URL=https://id.sigs.tsinghua.edu.cn
SSO_CLIENT_ID=APP112
SSO_CLIENT_SECRET=your-client-secret
SSO_REDIRECT_URI=http://your-domain/oauth2
SSO_LOGOUT_URL=https://sso.sigs.tsinghua.edu.cn/portal/sso/logout.html
SSO_LOGOUT_REDIRECT_URL=http://your-domain/
SSO_STATE_COOKIE_NAME=campus.oauth_state
SSO_STATE_MAX_AGE_MS=600000
SSO_STATE_SECRET=please-change-me

# Datahub 配置
DATAHUB_BASIC_PERSON_URL=https://api.sigs.tsinghua.edu.cn/v1/basic/api_basic_person
DATAHUB_API_KEY=your-datahub-api-key
DATAHUB_SERVICE_ID=jsjb
DB_HOST=219.223.170.14
DB_PORT=3306
DB_USER=response_test
DB_PASSWORD=your-db-password
DB_NAME=response_test
PORTAL_TODO_API_KEY=your-portal-todo-api-key
PORTAL_TODO_SERVICE_ID=QX1oRe
VITE_INTERNATIONAL_DEPARTMENT_NAME=
EOF

# 创建启动脚本
cat > "$DEPLOY_DIR/start.sh" << 'STARTEOF'
#!/bin/bash
# 校园12345系统启动脚本

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== 校园12345系统启动 ===${NC}"

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "错误: 未找到 Node.js，请先安装 Node.js 16+"
  exit 1
fi

# 获取脚本所在目录
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 创建必要的目录
mkdir -p server/uploads
mkdir -p logs

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}安装依赖...${NC}"
  npm install --production
fi

# 启动服务
echo -e "${GREEN}启动服务器...${NC}"
echo -e "${YELLOW}访问地址: http://$(hostname -I | awk '{print $1}'):${PORT:-3001}${NC}"

# 使用 PM2 或直接启动
if command -v pm2 &> /dev/null; then
  pm2 start server/index.js --name campus-12345
  pm2 save
  echo -e "${GREEN}已使用 PM2 启动，运行 'pm2 logs campus-12345' 查看日志${NC}"
else
  echo -e "${YELLOW}建议安装 PM2 进行进程管理: npm install -g pm2${NC}"
  echo -e "${GREEN}直接启动服务器...${NC}"
  node server/index.js
fi
STARTEOF
chmod +x "$DEPLOY_DIR/start.sh"

# 创建停止脚本
cat > "$DEPLOY_DIR/stop.sh" << 'STOPEOF'
#!/bin/bash
# 停止服务

if command -v pm2 &> /dev/null; then
  pm2 stop campus-12345 2>/dev/null || true
  pm2 delete campus-12345 2>/dev/null || true
  echo "服务已停止"
else
  pkill -f "node server/index.js" 2>/dev/null || true
  echo "服务已停止"
fi
STOPEOF
chmod +x "$DEPLOY_DIR/stop.sh"

# 创建重启脚本
cat > "$DEPLOY_DIR/restart.sh" << 'RESTARTEOF'
#!/bin/bash
# 重启服务

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

./stop.sh
sleep 2
./start.sh
RESTARTEOF
chmod +x "$DEPLOY_DIR/restart.sh"

# 创建安装脚本
cat > "$DEPLOY_DIR/install.sh" << 'INSTALLEOF'
#!/bin/bash
# 安装脚本

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== 校园12345系统安装 ===${NC}"

# 获取脚本所在目录
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}安装 Node.js...${NC}"
  if command -v apt-get &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v yum &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo yum install -y nodejs
  else
    echo "无法自动安装 Node.js，请手动安装 Node.js 16+"
    exit 1
  fi
fi

echo -e "${GREEN}Node.js 版本: $(node -v)${NC}"
echo -e "${GREEN}npm 版本: $(npm -v)${NC}"

# 安装依赖
echo -e "${YELLOW}安装项目依赖...${NC}"
npm install --production

# 安装 PM2
if ! command -v pm2 &> /dev/null; then
  echo -e "${YELLOW}安装 PM2 进程管理器...${NC}"
  npm install -g pm2
  pm2 startup
fi

echo -e "${GREEN}安装完成！${NC}"
echo -e "${YELLOW}请先修改 .env 配置文件，然后运行 ./start.sh 启动服务${NC}"
INSTALLEOF
chmod +x "$DEPLOY_DIR/install.sh"

# 创建 README
cat > "$DEPLOY_DIR/README.md" << 'READMEEOF'
# 校园12345系统 Linux 部署包

## 快速开始

### 1. 安装
```bash
chmod +x install.sh
./install.sh
```

### 2. 配置
编辑 `.env` 文件，修改以下配置：
- `JWT_SECRET`: 修改为随机字符串
- `SSO_CLIENT_SECRET`: SSO 客户端密钥
- `SSO_REDIRECT_URI`: SSO 回调地址
- `SSO_LOGOUT_REDIRECT_URL`: 退出登录跳转地址

### 3. 启动
```bash
./start.sh
```

### 4. 访问
- 地址: http://服务器IP:3001
- 超级管理员: superadmin / superadmin123

## 常用命令

```bash
# 启动服务
./start.sh

# 停止服务
./stop.sh

# 重启服务
./restart.sh

# 查看日志 (PM2)
pm2 logs campus-12345

# 查看状态 (PM2)
pm2 status
```

## 目录结构

```
├── server/          # 服务器端代码
├── dist/            # 前端构建产物
├── scripts/         # 工具脚本
├── logs/            # 日志目录
├── .env             # 环境配置
├── start.sh         # 启动脚本
├── stop.sh          # 停止脚本
├── restart.sh       # 重启脚本
└── install.sh       # 安装脚本
```

## 数据库

系统统一使用远程 MySQL 数据库 `219.223.170.14/response_test`，首次运行会自动补齐必要表结构。

## 同步人员数据

```bash
node scripts/sync-datahub-basic-persons.js
```
READMEEOF

echo -e "${YELLOW}5. 打包部署包...${NC}"
cd /tmp
tar -czf "$ARCHIVE_NAME" "$DEPLOY_NAME"

# 移动到项目目录
mv "$ARCHIVE_NAME" "$PROJECT_DIR/deploy-packages/"

# 清理
rm -rf "$DEPLOY_DIR"

echo -e "${GREEN}=== 打包完成 ===${NC}"
echo -e "部署包位置: deploy-packages/$ARCHIVE_NAME"
echo -e "大小: $(du -h "$PROJECT_DIR/deploy-packages/$ARCHIVE_NAME" | cut -f1)"
