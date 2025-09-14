const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * 验证JWT令牌中间件
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '访问令牌缺失',
        code: 'TOKEN_MISSING'
      });
    }

    // 验证令牌
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production');
    
    // 检查令牌类型
    if (decoded.type !== 'access') {
      return res.status(401).json({
        success: false,
        message: '无效的令牌类型',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    // 查找用户
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用户不存在',
        code: 'USER_NOT_FOUND'
      });
    }

    // 检查用户状态
    if (user.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: '账号已被禁用',
        code: 'USER_BANNED'
      });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: '账号未激活',
        code: 'USER_INACTIVE'
      });
    }

    // 将用户信息添加到请求对象
    req.user = {
      userId: user._id,
      openid: user.openid,
      nickname: user.nickname,
      membership: user.membership,
      stats: user.stats
    };

    // 更新用户最后活跃时间（异步，不等待）
    user.updateActivity().catch(err => {
      logger.warn('更新用户活跃时间失败:', err.message);
    });

    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '访问令牌已过期',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: '无效的访问令牌',
        code: 'INVALID_TOKEN'
      });
    }

    logger.error('认证中间件错误:', error);
    res.status(500).json({
      success: false,
      message: '认证失败',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * 可选认证中间件（令牌可有可无）
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      // 没有令牌，继续执行，但req.user为空
      req.user = null;
      return next();
    }

    // 有令牌，尝试验证
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production');
    
    if (decoded.type === 'access') {
      const user = await User.findById(decoded.userId);
      if (user && user.status === 'active') {
        req.user = {
          userId: user._id,
          openid: user.openid,
          nickname: user.nickname,
          membership: user.membership,
          stats: user.stats
        };
        
        // 更新活跃时间
        user.updateActivity().catch(() => {});
      }
    }

    next();

  } catch (error) {
    // 令牌验证失败，但不阻止请求继续
    req.user = null;
    next();
  }
};

/**
 * 检查会员等级中间件
 * @param {string|Array} requiredLevel - 需要的会员等级
 */
const checkMembership = (requiredLevel) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '需要登录',
        code: 'LOGIN_REQUIRED'
      });
    }

    const userLevel = req.user.membership.level;
    const levels = ['free', 'premium', 'vip'];
    const required = Array.isArray(requiredLevel) ? requiredLevel : [requiredLevel];
    
    // 检查用户等级是否满足要求
    const userLevelIndex = levels.indexOf(userLevel);
    const hasPermission = required.some(level => {
      const requiredIndex = levels.indexOf(level);
      return userLevelIndex >= requiredIndex;
    });

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `需要 ${required.join(' 或 ')} 会员权限`,
        code: 'INSUFFICIENT_MEMBERSHIP',
        userLevel,
        requiredLevel
      });
    }

    next();
  };
};

/**
 * 检查功能权限中间件
 * @param {string} feature - 功能名称
 * @param {number} value - 需要检查的数值（可选）
 */
const checkFeaturePermission = (feature, value = 1) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '需要登录',
        code: 'LOGIN_REQUIRED'
      });
    }

    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: '用户不存在',
          code: 'USER_NOT_FOUND'
        });
      }

      // 检查功能权限
      const hasPermission = user.checkPermission(feature, value);
      if (!hasPermission) {
        const featureMessages = {
          maxTasks: `最多创建 ${user.membership.features.maxTasks} 个监控任务`,
          maxKeywords: `每个任务最多 ${user.membership.features.maxKeywordsPerTask} 个关键词`,
          maxPages: `最多监控 ${user.membership.features.maxMonitorPages} 页`
        };

        return res.status(403).json({
          success: false,
          message: featureMessages[feature] || '功能权限不足',
          code: 'FEATURE_PERMISSION_DENIED',
          feature,
          userLevel: user.membership.level,
          limit: user.membership.features[feature]
        });
      }

      next();

    } catch (error) {
      logger.error('权限检查失败:', error);
      res.status(500).json({
        success: false,
        message: '权限检查失败',
        code: 'PERMISSION_CHECK_ERROR'
      });
    }
  };
};

/**
 * 管理员权限中间件
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: '需要登录',
      code: 'LOGIN_REQUIRED'
    });
  }

  // 这里可以添加管理员角色检查逻辑
  // 目前简单地检查是否为VIP用户
  if (req.user.membership.level !== 'vip') {
    return res.status(403).json({
      success: false,
      message: '需要管理员权限',
      code: 'ADMIN_REQUIRED'
    });
  }

  next();
};

/**
 * API速率限制中间件
 * @param {number} maxRequests - 最大请求次数
 * @param {number} windowMs - 时间窗口（毫秒）
 */
const rateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.user ? `user_${req.user.userId}` : `ip_${req.ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // 获取或创建请求记录
    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const userRequests = requests.get(key);
    
    // 清理过期的请求记录
    const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
    requests.set(key, validRequests);

    // 检查是否超过限制
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: '请求过于频繁，请稍后再试',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // 记录当前请求
    validRequests.push(now);

    // 设置响应头
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': maxRequests - validRequests.length,
      'X-RateLimit-Reset': new Date(now + windowMs)
    });

    next();
  };
};

/**
 * 请求日志中间件
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();

  // 监听响应结束事件
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.api.request(req, res, duration);
  });

  next();
};

/**
 * 验证请求体中间件
 * @param {object} schema - 验证模式
 */
const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: '请求参数验证失败',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }

    req.body = value;
    next();
  };
};

/**
 * 错误处理中间件
 */
const errorHandler = (error, req, res, next) => {
  logger.api.error(req, error);

  // 数据库错误
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message
    }));
    
    return res.status(400).json({
      success: false,
      message: '数据验证失败',
      errors
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: '无效的ID格式'
    });
  }

  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: '数据已存在'
    });
  }

  // 默认错误响应
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || '服务器内部错误',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};

module.exports = {
  authenticateToken,
  optionalAuth,
  checkMembership,
  checkFeaturePermission,
  requireAdmin,
  rateLimit,
  requestLogger,
  validateBody,
  errorHandler
};
