const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // 微信小程序用户信息
  openid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  unionid: {
    type: String,
    sparse: true,
    index: true
  },
  
  // 用户基本信息
  nickname: {
    type: String,
    default: '未知用户'
  },
  avatarUrl: {
    type: String,
    default: ''
  },
  
  // 认证信息
  cookie: {
    type: String,
    default: '',
    select: false // 默认不查询敏感信息
  },
  cookieUpdatedAt: {
    type: Date
  },
  
  // 用户设置
  settings: {
    // 通知设置
    notifications: {
      newProduct: {
        type: Boolean,
        default: true
      },
      lowPriceAlert: {
        type: Boolean,
        default: true
      },
      taskStatus: {
        type: Boolean,
        default: true
      }
    },
    
    // 默认监控设置
    defaultMonitor: {
      interval: {
        type: Number,
        default: 30,
        min: 10,
        max: 3600
      },
      monitorPages: {
        type: Number,
        default: 3,
        min: 1,
        max: 10
      },
      minPrice: {
        type: Number,
        default: 0,
        min: 0
      },
      maxPrice: {
        type: Number,
        default: 999999,
        min: 0
      },
      enableAlert: {
        type: Boolean,
        default: false
      },
      alertPrice: {
        type: Number,
        default: 100,
        min: 0
      },
      soundAlert: {
        type: Boolean,
        default: true
      },
      multiImages: {
        type: Boolean,
        default: true
      }
    }
  },
  
  // 使用统计
  stats: {
    totalTasks: {
      type: Number,
      default: 0
    },
    runningTasks: {
      type: Number,
      default: 0
    },
    totalProductsFound: {
      type: Number,
      default: 0
    },
    totalLowPriceAlerts: {
      type: Number,
      default: 0
    },
    lastActiveAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // 会员信息
  membership: {
    level: {
      type: String,
      enum: ['free', 'premium', 'vip'],
      default: 'free'
    },
    expiredAt: {
      type: Date
    },
    features: {
      maxTasks: {
        type: Number,
        default: 3
      },
      maxKeywordsPerTask: {
        type: Number,
        default: 5
      },
      maxMonitorPages: {
        type: Number,
        default: 5
      },
      historyDays: {
        type: Number,
        default: 30
      }
    }
  },
  
  // 状态
  status: {
    type: String,
    enum: ['active', 'inactive', 'banned'],
    default: 'active'
  },
  
  // 时间戳
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.cookie;
      delete ret.__v;
      return ret;
    }
  }
});

// 索引
userSchema.index({ createdAt: -1 });
userSchema.index({ 'stats.lastActiveAt': -1 });
userSchema.index({ 'membership.level': 1 });

// 中间件 - 更新时间
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// 实例方法 - 更新Cookie
userSchema.methods.updateCookie = function(cookie) {
  this.cookie = cookie;
  this.cookieUpdatedAt = new Date();
  this.stats.lastActiveAt = new Date();
  return this.save();
};

// 实例方法 - 检查Cookie是否过期
userSchema.methods.isCookieExpired = function() {
  if (!this.cookieUpdatedAt) return true;
  const daysSinceCookieUpdate = (Date.now() - this.cookieUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceCookieUpdate > 7; // Cookie 7天过期
};

// 实例方法 - 更新活跃时间
userSchema.methods.updateActivity = function() {
  this.stats.lastActiveAt = new Date();
  return this.save();
};

// 实例方法 - 检查功能权限
userSchema.methods.checkPermission = function(feature, value = 1) {
  const features = this.membership.features;
  
  switch (feature) {
    case 'maxTasks':
      return this.stats.runningTasks < features.maxTasks;
    case 'maxKeywords':
      return value <= features.maxKeywordsPerTask;
    case 'maxPages':
      return value <= features.maxMonitorPages;
    default:
      return true;
  }
};

// 实例方法 - 增加任务计数
userSchema.methods.incrementTaskCount = function() {
  this.stats.totalTasks += 1;
  this.stats.runningTasks += 1;
  return this.save();
};

// 实例方法 - 减少运行任务计数
userSchema.methods.decrementRunningTaskCount = function() {
  this.stats.runningTasks = Math.max(0, this.stats.runningTasks - 1);
  return this.save();
};

// 实例方法 - 增加发现商品计数
userSchema.methods.incrementProductCount = function(newProducts = 0, lowPriceAlerts = 0) {
  this.stats.totalProductsFound += newProducts;
  this.stats.totalLowPriceAlerts += lowPriceAlerts;
  return this.save();
};

// 静态方法 - 根据openid查找或创建用户
userSchema.statics.findOrCreateByOpenid = async function(openid, userInfo = {}) {
  let user = await this.findOne({ openid });
  
  if (!user) {
    user = new this({
      openid,
      nickname: userInfo.nickname || '未知用户',
      avatarUrl: userInfo.avatarUrl || '',
      unionid: userInfo.unionid,
      lastLoginAt: new Date()
    });
    await user.save();
  } else {
    // 更新登录时间和用户信息
    user.lastLoginAt = new Date();
    user.stats.lastActiveAt = new Date();
    
    if (userInfo.nickname) user.nickname = userInfo.nickname;
    if (userInfo.avatarUrl) user.avatarUrl = userInfo.avatarUrl;
    if (userInfo.unionid && !user.unionid) user.unionid = userInfo.unionid;
    
    await user.save();
  }
  
  return user;
};

// 静态方法 - 获取用户统计信息
userSchema.statics.getStats = async function() {
  const totalUsers = await this.countDocuments();
  const activeUsers = await this.countDocuments({
    'stats.lastActiveAt': { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });
  const premiumUsers = await this.countDocuments({
    'membership.level': { $in: ['premium', 'vip'] }
  });
  
  return {
    totalUsers,
    activeUsers,
    premiumUsers,
    freeUsers: totalUsers - premiumUsers
  };
};

// 虚拟字段 - 是否为新用户
userSchema.virtual('isNewUser').get(function() {
  const daysSinceCreation = (Date.now() - this.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceCreation <= 1;
});

// 虚拟字段 - 活跃状态
userSchema.virtual('isActive').get(function() {
  const daysSinceActive = (Date.now() - this.stats.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceActive <= 7;
});

module.exports = mongoose.model('User', userSchema);
