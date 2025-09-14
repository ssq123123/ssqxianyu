const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 自定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // 如果有额外的元数据，添加到日志中
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// 创建logger实例
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'xianyu-monitor' },
  transports: [
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // 警告日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'warn.log'),
      level: 'warn',
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // 综合日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // 监控专用日志
    new winston.transports.File({
      filename: path.join(logDir, 'monitor.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 3,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// 开发环境下同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let logMessage = `${timestamp} [${level}]: ${message}`;
        
        if (Object.keys(meta).length > 0) {
          logMessage += ` ${JSON.stringify(meta)}`;
        }
        
        return logMessage;
      })
    )
  }));
}

// 监控相关的专用日志方法
logger.monitor = {
  taskStart: (taskId, userId, keywords) => {
    logger.info('Monitor Task Started', {
      category: 'monitor',
      action: 'task_start',
      taskId,
      userId,
      keywords: keywords.map(k => k.keyword)
    });
  },
  
  taskStop: (taskId, userId, stats) => {
    logger.info('Monitor Task Stopped', {
      category: 'monitor',
      action: 'task_stop',
      taskId,
      userId,
      stats
    });
  },
  
  roundComplete: (taskId, roundNumber, results) => {
    logger.info('Monitor Round Completed', {
      category: 'monitor',
      action: 'round_complete',
      taskId,
      roundNumber,
      totalChecked: results.totalChecked,
      newProducts: results.newProducts,
      lowPriceAlerts: results.lowPriceAlerts
    });
  },
  
  productFound: (taskId, product, isAlert = false) => {
    logger.info('New Product Found', {
      category: 'monitor',
      action: isAlert ? 'low_price_alert' : 'product_found',
      taskId,
      itemId: product.itemId,
      price: product.price,
      keyword: product.sourceKeyword,
      isAlert
    });
  },
  
  error: (taskId, error, context = {}) => {
    logger.error('Monitor Task Error', {
      category: 'monitor',
      action: 'task_error',
      taskId,
      error: error.message,
      stack: error.stack,
      ...context
    });
  }
};

// API相关的专用日志方法
logger.api = {
  request: (req, res, responseTime) => {
    const logData = {
      category: 'api',
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress
    };
    
    if (res.statusCode >= 400) {
      logger.warn('API Request Error', logData);
    } else {
      logger.info('API Request', logData);
    }
  },
  
  auth: (userId, action, success = true, reason = '') => {
    logger.info('Authentication', {
      category: 'auth',
      action,
      userId,
      success,
      reason
    });
  },
  
  error: (req, error) => {
    logger.error('API Error', {
      category: 'api',
      method: req.method,
      url: req.originalUrl,
      error: error.message,
      stack: error.stack,
      body: req.body,
      query: req.query,
      params: req.params
    });
  }
};

// 系统相关的专用日志方法
logger.system = {
  startup: (port, environment) => {
    logger.info('Server Started', {
      category: 'system',
      action: 'startup',
      port,
      environment,
      timestamp: new Date().toISOString()
    });
  },
  
  shutdown: (reason = 'manual') => {
    logger.info('Server Shutdown', {
      category: 'system',
      action: 'shutdown',
      reason,
      timestamp: new Date().toISOString()
    });
  },
  
  dbConnect: (uri) => {
    logger.info('Database Connected', {
      category: 'system',
      action: 'db_connect',
      uri: uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@') // 隐藏密码
    });
  },
  
  dbDisconnect: () => {
    logger.info('Database Disconnected', {
      category: 'system',
      action: 'db_disconnect'
    });
  },
  
  error: (error, context = {}) => {
    logger.error('System Error', {
      category: 'system',
      error: error.message,
      stack: error.stack,
      ...context
    });
  }
};

// 性能监控
logger.performance = {
  slow: (operation, duration, threshold = 1000) => {
    if (duration > threshold) {
      logger.warn('Slow Operation', {
        category: 'performance',
        operation,
        duration: `${duration}ms`,
        threshold: `${threshold}ms`
      });
    }
  },
  
  memory: () => {
    const used = process.memoryUsage();
    logger.info('Memory Usage', {
      category: 'performance',
      rss: `${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB`,
      heapTotal: `${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB`,
      heapUsed: `${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`,
      external: `${Math.round(used.external / 1024 / 1024 * 100) / 100} MB`
    });
  }
};

// 定期输出内存使用情况（仅在开发环境）
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    logger.performance.memory();
  }, 60000); // 每分钟
}

module.exports = logger;
