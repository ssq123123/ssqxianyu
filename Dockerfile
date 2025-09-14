# 闲鱼监控系统 Docker 配置（Debian 版，glibc 环境更稳定）
FROM node:20-bullseye-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 安装系统依赖（含构建原生模块所需的工具，如 sharp）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      dumb-init \
      curl \
      ca-certificates \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*

# 创建非root用户
RUN groupadd -g 1001 -r nodejs && \
    useradd -r -g nodejs -u 1001 nodeuser

# 复制package文件
COPY backend/package*.json ./

# 配置 npm 国内源与 sharp 二进制镜像，提升构建成功率
ENV SHARP_DIST_BASE_URL=https://npmmirror.com/mirrors/sharp-libvips/

# 安装Node.js依赖（无 lockfile 时使用 install）
RUN npm config set registry https://registry.npmmirror.com && \
    npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# 复制应用代码
COPY backend/ ./

# 创建必要的目录
RUN mkdir -p logs public/uploads public/exports public/images && \
    chown -R nodeuser:nodejs /app

# 切换到非root用户
USER nodeuser

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# 启动应用
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
