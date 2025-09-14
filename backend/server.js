const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// 加载环境变量
require('dotenv').config();

// 导入配置和中间件
const config = require('./config/app');
const { authenticateToken, requestLogger, errorHandler } = require('./middleware/auth');

// 导入路由
const authRoutes = require('./routes/auth');
const monitorRoutes = require('./routes/monitor');
const productRoutes = require('./routes/products');

// 导入服务
const MonitorService = require('./services/monitorService');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);

// 配置Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// 中间件配置
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors(config.cors));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/exports', express.static(path.join(__dirname, 'public/exports')));

// 确保必要的目录存在
const createDirectories = () => {
  const dirs = [
    'public/uploads',
    'public/exports', 
    'public/images',
    'logs'
  ];
  
  dirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      logger.info(`Created directory: ${fullPath}`);
    }
  });
};

createDirectories();

// 数据库连接（带重试且不阻塞服务启动）
let monitorStarted = false;
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  const maxRetries = 30; // 大约重试15分钟（30*30s）
  let attempt = 0;

  const tryConnect = async () => {
    attempt += 1;
    try {
      await mongoose.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 15000
      });
      logger.info('MongoDB连接成功');

      if (!monitorStarted) {
        monitorService.start();
        monitorStarted = true;
        logger.info('监控服务已启动');
      }
    } catch (error) {
      logger.error(`MongoDB连接失败(第${attempt}次):`, error.message);
      if (attempt < maxRetries) {
        setTimeout(tryConnect, 30000); // 30秒后重试
      } else {
        logger.error('多次重试后仍无法连接MongoDB，继续提供基本健康检查');
      }
    }
  };

  tryConnect();
};

// 请求日志中间件
app.use(requestLogger);

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/monitor', authenticateToken, monitorRoutes);
app.use('/api/products', authenticateToken, productRoutes);

// 健康检查接口
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    dbState: mongoose.connection.readyState // 0=disconnected,1=connected,2=connecting,3=disconnecting
  });
});

// 全局错误处理
app.use(errorHandler);

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

// Socket.IO连接处理
io.on('connection', (socket) => {
  logger.info(`客户端连接: ${socket.id}`);
  
  // 加入监控房间
  socket.on('joinMonitor', (data) => {
    const { userId, taskId } = data;
    const room = `monitor_${userId}_${taskId}`;
    socket.join(room);
    socket.userId = userId;
    socket.taskId = taskId;
    socket.room = room;
    
    logger.info(`用户 ${userId} 加入监控房间: ${room}`);
    
    // 发送当前监控状态
    socket.emit('monitorStatus', {
      connected: true,
      room: room,
      timestamp: new Date().toISOString()
    });
  });
  
  // 离开监控房间
  socket.on('leaveMonitor', () => {
    if (socket.room) {
      socket.leave(socket.room);
      logger.info(`用户 ${socket.userId} 离开监控房间: ${socket.room}`);
    }
  });
  
  // 处理客户端断开连接
  socket.on('disconnect', () => {
    logger.info(`客户端断开连接: ${socket.id}`);
  });
  
  // 处理错误
  socket.on('error', (error) => {
    logger.error(`Socket错误 (${socket.id}):`, error);
  });
});

// 初始化监控服务
const monitorService = new MonitorService(io);

// 启动服务器
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // 先启动HTTP服务，确保健康检查可通过
    server.listen(PORT, () => {
      logger.info(`服务器启动成功`);
      logger.info(`端口: ${PORT}`);
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`时间: ${new Date().toISOString()}`);
    });

    // 后台连接数据库（失败会自动重试，不影响服务存活）
    connectDB();
  } catch (error) {
    logger.error('服务器启动失败:', error);
    process.exit(1);
  }
};

// 优雅关闭处理
const gracefulShutdown = () => {
  logger.info('收到关闭信号，开始优雅关闭...');
  
  server.close(() => {
    logger.info('HTTP服务器已关闭');
    
    // 关闭监控服务
    if (monitorService) {
      monitorService.stop();
      logger.info('监控服务已停止');
    }
    
    // 关闭数据库连接
    mongoose.connection.close(false, () => {
      logger.info('MongoDB连接已关闭');
      process.exit(0);
    });
  });
  
  // 如果10秒内无法优雅关闭，强制退出
  setTimeout(() => {
    logger.error('无法在10秒内优雅关闭，强制退出');
    process.exit(1);
  }, 10000);
};

// 监听关闭信号
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  logger.error('未捕获的异常:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error('未处理的Promise拒绝:', err);
  process.exit(1);
});

startServer();

// 导出应用实例（用于测试）
module.exports = { app, server, io };
