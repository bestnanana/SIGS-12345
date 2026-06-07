#!/bin/bash
# 校园12345系统 Linux 离线部署包打包脚本

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== 校园12345系统 Linux 离线部署包打包 ===${NC}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

DEPLOY_NAME="campus-12345-offline-$(date +%Y%m%d)"
DEPLOY_DIR="/tmp/${DEPLOY_NAME}"
ARCHIVE_NAME="${DEPLOY_NAME}.tar.gz"

echo -e "${YELLOW}1. 清理并创建部署目录...${NC}"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

echo -e "${YELLOW}2. 构建前端...${NC}"
npm run build 2>/dev/null || {
  echo "使用已有的构建产物..."
}

echo -e "${YELLOW}3. 复制文件...${NC}"

# 服务器端代码
cp -r server "$DEPLOY_DIR/"
rm -rf "$DEPLOY_DIR/server/data" "$DEPLOY_DIR/server/logs" "$DEPLOY_DIR/server/uploads"
mkdir -p "$DEPLOY_DIR/server/uploads"

# 前端构建产物
if [ -d "client/dist" ]; then
  cp -r client/dist "$DEPLOY_DIR/dist"
elif [ -d "dist" ]; then
  cp -r dist "$DEPLOY_DIR/"
fi

# 脚本
mkdir -p "$DEPLOY_DIR/scripts"
cp scripts/*.js "$DEPLOY_DIR/scripts/" 2>/dev/null || true

# 配置文件
cp package.json "$DEPLOY_DIR/"
cp package-lock.json "$DEPLOY_DIR/"

# 复制 node_modules（Linux x64 版本）
echo -e "${YELLOW}4. 复制 node_modules（可能需要几分钟）...${NC}"
# 只复制生产依赖相关的模块
cp -r node_modules "$DEPLOY_DIR/"

# 环境配置
cat > "$DEPLOY_DIR/.env" << 'EOF'
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
JWT_SECRET=change-this-to-random-string
JWT_EXPIRES_IN=8h
SESSION_COOKIE_NAME=campus.sid
SESSION_MAX_AGE_MS=28800000
SSO_AUTHORIZE_BASE_URL=https://id.sigs.tsinghua.edu.cn
SSO_API_BASE_URL=https://id.sigs.tsinghua.edu.cn
SSO_CLIENT_ID=APP112
SSO_CLIENT_SECRET=your-client-secret
SSO_REDIRECT_URI=http://your-domain/oauth2
SSO_LOGOUT_URL=https://sso.sigs.tsinghua.edu.cn/portal/sso/logout.html
SSO_LOGOUT_REDIRECT_URL=http://your-domain/
SSO_STATE_COOKIE_NAME=campus.oauth_state
SSO_STATE_MAX_AGE_MS=600000
SSO_STATE_SECRET=change-this
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
EOF

# 创建启动脚本
cat > "$DEPLOY_DIR/start.sh" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== 校园12345系统启动 ===${NC}"

mkdir -p server/uploads logs

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "错误: 未找到 Node.js"
  echo "请先安装 Node.js: https://nodejs.org/"
  exit 1
fi

echo -e "${GREEN}Node.js: $(node -v)${NC}"
echo -e "${GREEN}启动服务器...${NC}"

if command -v pm2 &> /dev/null; then
  pm2 start server/index.js --name campus-12345 --max-memory-restart 512M
  pm2 save
  echo -e "${GREEN}已使用 PM2 启动${NC}"
  echo -e "查看日志: pm2 logs campus-12345"
else
  echo -e "${YELLOW}建议安装 PM2: npm install -g pm2${NC}"
  node server/index.js
fi
EOF
chmod +x "$DEPLOY_DIR/start.sh"

# 停止脚本
cat > "$DEPLOY_DIR/stop.sh" << 'EOF'
#!/bin/bash
if command -v pm2 &> /dev/null; then
  pm2 stop campus-12345 2>/dev/null || true
  pm2 delete campus-12345 2>/dev/null || true
else
  pkill -f "node server/index.js" 2>/dev/null || true
fi
echo "服务已停止"
EOF
chmod +x "$DEPLOY_DIR/stop.sh"

# 重启脚本
cat > "$DEPLOY_DIR/restart.sh" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
./stop.sh
sleep 2
./start.sh
EOF
chmod +x "$DEPLOY_DIR/restart.sh"

# 同步数据脚本
cat > "$DEPLOY_DIR/sync-data.sh" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
node scripts/sync-datahub-basic-persons.js
EOF
chmod +x "$DEPLOY_DIR/sync-data.sh"

# README
cat > "$DEPLOY_DIR/README.md" << 'EOF'
# 校园12345系统 - 离线部署包

## 系统要求
- Linux x64
- Node.js 16+ (需要预先安装)

## 快速部署

### 1. 解压
```bash
tar -xzf campus-12345-offline-*.tar.gz
cd campus-12345-offline-*
```

### 2. 修改配置
```bash
vi .env
```
必须修改的配置：
- `JWT_SECRET` - 改为随机字符串
- `SSO_CLIENT_SECRET` - SSO 密钥
- `SSO_REDIRECT_URI` - 回调地址
- `SSO_LOGOUT_REDIRECT_URL` - 退出跳转地址

### 3. 启动
```bash
./start.sh
```

### 4. 访问
- 地址: http://服务器IP:3001
- 超级管理员: superadmin / superadmin123

## 常用命令
```bash
./start.sh      # 启动
./stop.sh       # 停止
./restart.sh    # 重启
./sync-data.sh  # 同步人员数据
pm2 status      # 查看状态(PM2)
pm2 logs campus-12345  # 查看日志(PM2)
```

## 安装 Node.js (如未安装)

### 方式1: 使用自带的二进制包
```bash
# 下载 Node.js 二进制包
wget https://nodejs.org/dist/v18.20.0/node-v18.20.0-linux-x64.tar.xz
tar -xf node-v18.20.0-linux-x64.tar.xz
export PATH=$PWD/node-v18.20.0-linux-x64/bin:$PATH
echo 'export PATH=$PWD/node-v18.20.0-linux-x64/bin:$PATH' >> ~/.bashrc
```

### 方式2: 系统包管理器
```bash
# CentOS/RHEL
yum install -y nodejs

# Ubuntu/Debian
apt-get install -y nodejs
```

## 目录结构
```
├── server/        # 服务端代码
├── dist/          # 前端文件
├── scripts/       # 工具脚本
├── node_modules/  # 依赖包
├── .env           # 配置文件
├── start.sh       # 启动脚本
├── stop.sh        # 停止脚本
├── restart.sh     # 重启脚本
└── sync-data.sh   # 数据同步脚本
```
EOF

echo -e "${YELLOW}6. 打包（可能需要10-20分钟）...${NC}"
cd /tmp
tar -czf "$ARCHIVE_NAME" "$DEPLOY_NAME"
mv "$ARCHIVE_NAME" "$PROJECT_DIR/deploy-packages/"
rm -rf "$DEPLOY_DIR"

echo -e "${GREEN}=== 打包完成 ===${NC}"
echo -e "部署包: deploy-packages/$ARCHIVE_NAME"
echo -e "大小: $(du -h "$PROJECT_DIR/deploy-packages/$ARCHIVE_NAME" | cut -f1)"
