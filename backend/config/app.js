const path = require('path');

module.exports = {
  // 应用基本配置
  app: {
    name: 'xianyu-monitor',
    version: '1.0.0',
    description: '闲鱼实时监控系统后端服务',
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    frontendUrl: process.env.FRONTEND_URL || 'https://localhost:3000'
  },

  // 数据库配置
  database: {
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/xianyu_monitor',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }
    }
  },

  // JWT配置
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
    expiresIn: '30d',
    refreshExpiresIn: '90d',
    issuer: 'xianyu-monitor',
    audience: 'xianyu-monitor-users'
  },

  // 微信小程序配置
  wechat: {
    appId: process.env.WECHAT_APP_ID || '',
    appSecret: process.env.WECHAT_APP_SECRET || '',
    loginUrl: 'https://api.weixin.qq.com/sns/jscode2session',
    tokenUrl: 'https://api.weixin.qq.com/cgi-bin/token'
  },

  // 加密配置
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32chars',
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16
  },

  // 闲鱼API配置
  xianyu: {
    apiUrl: 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/',
    appKey: '34839810',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
    requestDelay: 2000,
    maxRetries: 3,
    timeout: 15000
  },

  // 监控配置
  monitor: {
    defaultInterval: parseInt(process.env.DEFAULT_MONITOR_INTERVAL) || 30,
    minInterval: 10,
    maxInterval: 3600,
    maxPages: parseInt(process.env.MAX_MONITOR_PAGES) || 10,
    maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS) || 5,
    maxWorkers: 2,
    cleanupInterval: 2 * 60 * 60 * 1000, // 2小时清理一次
    historyRetentionDays: 30
  },

  // 文件存储配置
  storage: {
    uploadPath: path.join(__dirname, '../public/uploads'),
    exportPath: path.join(__dirname, '../public/exports'),
    imagePath: path.join(__dirname, '../public/images'),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    allowedImageFormats: ['jpg', 'jpeg', 'png', 'gif', 'bmp'],
    exportFileMaxAge: parseInt(process.env.EXPORT_FILE_MAX_AGE) || 72, // 72小时
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 24 // 24小时
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxSize: '10m',
    maxFiles: 5,
    datePattern: 'YYYY-MM-DD',
    verbose: process.env.VERBOSE_LOGGING === 'true',
    categories: {
      api: true,
      monitor: true,
      system: true,
      auth: true,
      error: true
    }
  },

  // API限制配置
  rateLimit: {
    windowMs: parseInt(process.env.API_RATE_WINDOW) || 15 * 60 * 1000, // 15分钟
    max: parseInt(process.env.API_RATE_LIMIT) || 100, // 限制每个IP每15分钟100次请求
    message: {
      success: false,
      message: '请求过于频繁，请稍后再试',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  },

  // CORS配置
  cors: {
    origin: process.env.NODE_ENV === 'production' ? 
      [process.env.FRONTEND_URL] : 
      ['http://localhost:3000', 'https://servicewechat.com'],
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  },

  // 会员配置
  membership: {
    free: {
      maxTasks: 3,
      maxKeywordsPerTask: 5,
      maxMonitorPages: 5,
      historyDays: 30,
      features: ['basic_monitor', 'excel_export']
    },
    premium: {
      maxTasks: 10,
      maxKeywordsPerTask: 10,
      maxMonitorPages: 10,
      historyDays: 90,
      features: ['basic_monitor', 'excel_export', 'advanced_stats', 'custom_alerts']
    },
    vip: {
      maxTasks: 50,
      maxKeywordsPerTask: 20,
      maxMonitorPages: 20,
      historyDays: 365,
      features: ['basic_monitor', 'excel_export', 'advanced_stats', 'custom_alerts', 'api_access', 'priority_support']
    }
  },

  // 通知配置
  notification: {
    email: {
      host: process.env.EMAIL_HOST || 'smtp.qq.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
      },
      from: process.env.EMAIL_FROM || ''
    },
    wechat: {
      enabled: false, // 可以后续扩展微信消息推送
      templateId: ''
    }
  },

  // 安全配置
  security: {
    helmet: {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    },
    session: {
      secret: process.env.SESSION_SECRET || 'default-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24小时
      }
    }
  },

  // Redis配置（可选）
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    enabled: !!process.env.REDIS_URL,
    options: {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3
    }
  },

  // 调试配置
  debug: {
    enabled: process.env.DEBUG === 'true',
    verbose: process.env.VERBOSE_LOGGING === 'true',
    showStackTrace: process.env.NODE_ENV === 'development'
  }
};
