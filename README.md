# 闲鱼实时监控系统

一个基于微信小程序的闲鱼商品实时监控系统，支持多关键词监控、低价预警、数据导出等功能。

## 📋 功能特性

### 核心功能
- **实时监控**: 支持多关键词、多页面的实时商品监控
- **智能预警**: 低价商品实时预警，第一时间发现好价
- **数据分析**: 详细的监控统计和数据分析报告
- **批量导出**: 支持Excel格式的监控数据导出
- **历史记录**: 完整的监控历史和商品发现记录

### 技术特性
- **微信小程序**: 原生小程序体验，随时随地监控
- **实时通信**: WebSocket实时推送监控状态和结果
- **云端部署**: 支持服务器部署，24小时不间断监控
- **安全可靠**: 数据加密存储，用户隐私保护
- **高性能**: 集群部署，支持大量并发监控任务

## 🏗️ 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   微信小程序     │    │    后端服务     │    │   数据存储      │
│                 │    │                 │    │                 │
│  ┌──────────┐   │    │  ┌──────────┐   │    │  ┌──────────┐   │
│  │   首页   │   │    │  │ Express  │   │    │  │ MongoDB  │   │
│  │   监控   │◀──┼────┼──│ Socket.io│   │    │  │   用户   │   │
│  │   商品   │   │    │  │   API    │   │    │  │   任务   │   │
│  │   历史   │   │    │  └──────────┘   │    │  │   商品   │   │
│  │   设置   │   │    │                 │    │  └──────────┘   │
│  └──────────┘   │    │  ┌──────────┐   │    │                 │
│                 │    │  │ 监控服务  │   │    │  ┌──────────┐   │
└─────────────────┘    │  │ 闲鱼爬虫  │   │    │  │  Redis   │   │
                       │  │ 数据处理  │   │    │  │  缓存    │   │
                       │  └──────────┘   │    │  └──────────┘   │
                       └─────────────────┘    └─────────────────┘
```

## 📁 项目结构

```
xianyu-monitor/
├── backend/                 # 后端服务
│   ├── config/             # 配置文件
│   ├── controllers/        # 控制器
│   ├── models/             # 数据模型
│   ├── routes/             # 路由定义
│   ├── services/           # 业务服务
│   ├── middleware/         # 中间件
│   ├── utils/              # 工具函数
│   ├── scripts/            # 部署脚本
│   ├── package.json        # 依赖配置
│   └── server.js           # 服务入口
├── miniprogram/            # 小程序前端
│   ├── pages/              # 页面文件
│   ├── components/         # 组件文件  
│   ├── utils/              # 工具函数
│   ├── images/             # 图片资源
│   ├── app.js              # 应用入口
│   ├── app.json            # 应用配置
│   └── app.wxss            # 全局样式
├── docs/                   # 文档目录
│   ├── API.md              # API文档
│   ├── DEPLOY.md           # 部署文档
│   └── GUIDE.md            # 使用指南
├── docker-compose.yml      # Docker编排
├── Dockerfile              # Docker镜像
├── README.md               # 项目说明
└── 服务器部署完整教程.md     # 部署教程
```

## 🚀 快速开始

### 环境要求

- Node.js 16+
- MongoDB 5.0+
- Redis 6.0+（可选）
- 微信开发者工具

### 1. 克隆项目

```bash
git clone https://github.com/your-username/xianyu-monitor.git
cd xianyu-monitor
```

### 2. 后端部署

```bash
cd backend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑.env文件，填入相关配置

# 启动MongoDB
sudo systemctl start mongod

# 启动开发服务器
npm run dev
```

### 3. 小程序配置

```bash
# 使用微信开发者工具打开miniprogram目录
# 配置AppID和服务器域名
# 上传代码并发布
```

### 4. 部署到生产环境

详细部署教程请参考：[服务器部署完整教程.md](./服务器部署完整教程.md)

```bash
# 使用自动化部署脚本
chmod +x backend/scripts/deploy.sh
./backend/scripts/deploy.sh production
```

## 🐳 Docker部署

### 快速启动

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态  
docker-compose ps

# 查看日志
docker-compose logs -f xianyu-monitor
```

### 环境配置

编辑`docker-compose.yml`文件中的环境变量：

```yaml
environment:
  - WECHAT_APP_ID=your_wechat_app_id
  - WECHAT_APP_SECRET=your_wechat_app_secret
  - JWT_SECRET=your_jwt_secret
  # ... 其他配置
```

## 📱 小程序功能

### 主要页面

1. **监控面板**: 查看监控状态、统计数据
2. **创建任务**: 设置监控关键词、价格范围、预警条件
3. **商品列表**: 浏览发现的商品，支持筛选和搜索
4. **历史记录**: 查看监控历史和数据统计
5. **个人中心**: 用户设置、Cookie管理、会员功能

### 核心功能

- **多关键词监控**: 支持同时监控多个关键词
- **价格区间过滤**: 精确控制监控价格范围
- **低价预警**: 设置预警价格，及时发现好价商品
- **实时通知**: WebSocket推送，即时接收监控结果
- **数据导出**: 支持导出Excel格式的监控数据
- **自动Cookie获取**: 简化Cookie设置流程

## 🔧 开发指南

### 后端开发

```bash
cd backend

# 启动开发服务器
npm run dev

# 运行测试
npm test

# 代码检查
npm run lint
```

### 小程序开发

```bash
# 使用微信开发者工具
# 1. 导入miniprogram目录
# 2. 配置项目设置
# 3. 本地预览和调试
```

### API文档

主要API接口：

- `POST /api/auth/login` - 用户登录
- `GET /api/auth/profile` - 获取用户信息
- `POST /api/auth/cookie` - 更新Cookie
- `GET /api/monitor/tasks` - 获取监控任务
- `POST /api/monitor/tasks` - 创建监控任务
- `GET /api/products` - 获取商品列表
- `POST /api/products/export` - 导出数据

详细API文档请参考：[docs/API.md](./docs/API.md)

## 📊 监控原理

### 数据获取

1. **Cookie认证**: 使用用户提供的Cookie进行身份验证
2. **API调用**: 模拟正常的网页请求获取商品数据
3. **数据解析**: 解析返回的JSON数据，提取商品信息
4. **图片处理**: 下载并优化商品图片

### 监控策略

1. **轮询机制**: 按设定间隔定期检查新商品
2. **去重算法**: 基于商品ID避免重复记录
3. **价格监控**: 实时检查价格变化和预警条件
4. **错误处理**: 自动重试和错误恢复机制

### 性能优化

1. **并发控制**: 限制同时运行的监控任务数量
2. **缓存机制**: 缓存常用数据减少数据库查询
3. **图片压缩**: 自动压缩图片节省存储空间
4. **数据清理**: 定期清理过期数据和日志

## 🔒 安全与隐私

### 数据安全

- **Cookie加密**: 用户Cookie使用AES加密存储
- **JWT认证**: API访问使用JWT token验证
- **HTTPS通信**: 所有通信使用HTTPS加密
- **输入验证**: 严格的参数验证防止注入攻击

### 隐私保护

- **最小权限**: 只收集必要的用户信息
- **数据隔离**: 用户数据严格隔离
- **定期清理**: 自动清理过期数据
- **透明政策**: 明确的隐私政策说明

## 🤝 贡献指南

### 贡献方式

1. Fork本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

### 开发规范

- 遵循ESLint代码规范
- 编写单元测试
- 更新相关文档
- 遵循语义化版本

## 📄 许可证

本项目采用 MIT 许可证。详情请参阅 [LICENSE](LICENSE) 文件。

## ⚠️ 免责声明

1. 本项目仅用于学习和研究目的
2. 请遵守闲鱼平台的使用条款和相关法律法规
3. 不对监控结果的准确性和可靠性承担责任
4. 使用本项目产生的任何后果由使用者自行承担

## 🆘 支持与反馈

### 获取帮助

- 📖 查看[使用指南](./docs/GUIDE.md)
- 🐛 提交[Issue](https://github.com/your-username/xianyu-monitor/issues)
- 💬 参与[讨论](https://github.com/your-username/xianyu-monitor/discussions)

### 联系方式

- 邮箱: your-email@example.com
- 微信: your-wechat-id

## 🎉 致谢

感谢所有为这个项目做出贡献的开发者和用户！

---

<div align="center">
  <p>如果这个项目对你有帮助，请给一个⭐️</p>
  <p>Made with ❤️ by <a href="https://github.com/your-username">Your Name</a></p>
</div>
