# MiniMax Audio Studio - Docker 部署指南

## 文件说明

已创建以下文件：

- `Dockerfile` - Docker 镜像构建文件
- `.dockerignore` - Docker 构建排除文件
- `docker-compose.yml` - Docker Compose 配置文件

## 快速开始

### 方法一：使用 Docker Compose（推荐）

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重启服务
docker-compose restart
```

访问地址：http://localhost:3000

### 方法二：使用 Docker 命令

```bash
# 1. 构建镜像
docker build -t minimax-audio-studio:latest .

# 2. 运行容器
docker run -d \
  --name minimax-audio-studio \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e MINIMAX_BASE_URL=https://api.minimaxi.com \
  -v $(pwd)/data:/app/data \
  minimax-audio-studio:latest

# 3. 查看日志
docker logs -f minimax-audio-studio

# 4. 停止容器
docker stop minimax-audio-studio

# 5. 删除容器
docker rm minimax-audio-studio
```

访问地址：http://localhost:3000

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `PORT` | 服务端口 | `3000` |
| `MINIMAX_BASE_URL` | MiniMax API 地址 | `https://api.minimaxi.com` |
| `MINIMAX_API_KEY` | MiniMax API Key（可选） | 空（可在设置页面配置） |

## 数据持久化

SQLite 数据库文件会保存在容器中。为了数据持久化，建议：

### 使用 Docker Compose

已经配置了 volume 映射，数据会自动保存到 `./data` 目录。

### 使用 Docker 命令

```bash
docker run -d \
  --name minimax-audio-studio \
  -p 3000:3000 \
  -v $(pwd)/minimax-studio.sqlite:/app/minimax-studio.sqlite \
  minimax-audio-studio:latest
```

## 镜像信息

- 基础镜像：`node:22-alpine`
- 镜像大小：约 200MB
- Exposed 端口：3000
- 健康检查：每 30 秒检查一次

## 常见问题

### 1. 容器启动失败

查看日志：
```bash
docker logs minimax-audio-studio
```

### 2. 数据库权限问题

```bash
chmod 666 minimax-studio.sqlite
```

### 3. 端口被占用

修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "8080:3000"  # 使用 8080 端口
```

### 4. 在生产环境部署

建议配置：
- 使用反向代理（Nginx/Traefik）
- 配置 HTTPS
- 设置环境变量 `MINIMAX_API_KEY`
- 使用外部数据库（如 PostgreSQL）

## 构建优化

如果需要更小的镜像：

```dockerfile
# 使用多阶段构建
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app .
```

## 推送镜像到仓库

```bash
# 标记镜像
docker tag minimax-audio-studio:latest your-username/minimax-audio-studio:latest

# 登录仓库
docker login

# 推送镜像
docker push your-username/minimax-audio-studio:latest
```

## 许可证

MIT
