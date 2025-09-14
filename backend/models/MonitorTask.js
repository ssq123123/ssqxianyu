const mongoose = require('mongoose');

const keywordSchema = new mongoose.Schema({
  keyword: {
    type: String,
    required: true,
    trim: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 5
  }
}, { _id: false });

const monitorTaskSchema = new mongoose.Schema({
  // 基本信息
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  
  // 监控配置
  keywords: {
    type: [keywordSchema],
    required: true,
    validate: {
      validator: function(keywords) {
        return keywords.length > 0 && keywords.length <= 5;
      },
      message: '关键词数量必须在1-5个之间'
    }
  },
  
  // 监控设置
  interval: {
    type: Number,
    required: true,
    min: 10,
    max: 3600,
    default: 30
  },
  monitorPages: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    default: 3
  },
  
  // 价格过滤
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
  
  // 低价预警
  enableAlert: {
    type: Boolean,
    default: false
  },
  alertPrice: {
    type: Number,
    min: 0
  },
  
  // Cookie信息
  cookie: {
    type: String,
    required: true,
    select: false
  },
  
  // 选项设置
  options: {
    multiImages: {
      type: Boolean,
      default: true
    },
    soundAlert: {
      type: Boolean,
      default: true
    },
    autoExport: {
      type: Boolean,
      default: false
    },
    exportFormat: {
      type: String,
      enum: ['excel', 'csv', 'json'],
      default: 'excel'
    }
  },
  
  // 任务状态
  status: {
    type: String,
    enum: ['draft', 'running', 'paused', 'stopped', 'error'],
    default: 'draft',
    index: true
  },
  
  // 运行时间
  startTime: {
    type: Date
  },
  stopTime: {
    type: Date
  },
  lastCheckTime: {
    type: Date
  },
  nextCheckTime: {
    type: Date
  },
  
  // 统计信息
  stats: {
    totalRounds: {
      type: Number,
      default: 0
    },
    totalProductsChecked: {
      type: Number,
      default: 0
    },
    totalNewProducts: {
      type: Number,
      default: 0
    },
    totalLowPriceAlerts: {
      type: Number,
      default: 0
    },
    successfulRounds: {
      type: Number,
      default: 0
    },
    failedRounds: {
      type: Number,
      default: 0
    },
    averageProductsPerRound: {
      type: Number,
      default: 0
    }
  },
  
  // 错误信息
  lastError: {
    message: String,
    timestamp: Date,
    code: String
  },
  
  // 导出设置
  export: {
    normalFile: {
      type: String,
      default: ''
    },
    alertFile: {
      type: String,
      default: ''
    },
    autoExportInterval: {
      type: Number,
      default: 24 // 小时
    },
    lastExportTime: {
      type: Date
    }
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

// 复合索引
monitorTaskSchema.index({ userId: 1, status: 1 });
monitorTaskSchema.index({ status: 1, nextCheckTime: 1 });
monitorTaskSchema.index({ createdAt: -1 });

// 虚拟字段 - 是否正在运行
monitorTaskSchema.virtual('isRunning').get(function() {
  return this.status === 'running';
});

// 虚拟字段 - 运行时长
monitorTaskSchema.virtual('runDuration').get(function() {
  if (this.startTime) {
    const endTime = this.stopTime || new Date();
    return Math.floor((endTime - this.startTime) / 1000); // 返回秒数
  }
  return 0;
});

// 虚拟字段 - 成功率
monitorTaskSchema.virtual('successRate').get(function() {
  const total = this.stats.successfulRounds + this.stats.failedRounds;
  return total > 0 ? (this.stats.successfulRounds / total * 100).toFixed(2) : 0;
});

// 中间件 - 更新时间
monitorTaskSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // 计算平均每轮商品数
  if (this.stats.totalRounds > 0) {
    this.stats.averageProductsPerRound = Math.round(
      this.stats.totalProductsChecked / this.stats.totalRounds
    );
  }
  
  next();
});

// 实例方法 - 启动任务
monitorTaskSchema.methods.start = function() {
  this.status = 'running';
  this.startTime = new Date();
  this.lastError = undefined;
  return this.save();
};

// 实例方法 - 停止任务
monitorTaskSchema.methods.stop = function(reason = 'manual') {
  this.status = 'stopped';
  this.stopTime = new Date();
  return this.save();
};

// 实例方法 - 暂停任务
monitorTaskSchema.methods.pause = function() {
  this.status = 'paused';
  return this.save();
};

// 实例方法 - 恢复任务
monitorTaskSchema.methods.resume = function() {
  this.status = 'running';
  this.lastError = undefined;
  return this.save();
};

// 实例方法 - 记录错误
monitorTaskSchema.methods.recordError = function(error, code = 'UNKNOWN') {
  this.lastError = {
    message: error.message || error,
    timestamp: new Date(),
    code: code
  };
  this.stats.failedRounds += 1;
  
  // 如果是关键错误，停止任务
  if (['TOKEN_EXPIRED', 'COOKIE_INVALID'].includes(code)) {
    this.status = 'error';
  }
  
  return this.save();
};

// 实例方法 - 更新统计信息
monitorTaskSchema.methods.updateStats = function(roundData) {
  this.stats.totalRounds += 1;
  this.stats.totalProductsChecked += roundData.totalChecked || 0;
  this.stats.totalNewProducts += roundData.newProducts || 0;
  this.stats.totalLowPriceAlerts += roundData.lowPriceAlerts || 0;
  this.stats.successfulRounds += 1;
  
  this.lastCheckTime = new Date();
  this.nextCheckTime = new Date(Date.now() + this.interval * 1000);
  
  return this.save();
};

// 实例方法 - 检查是否需要执行
monitorTaskSchema.methods.shouldExecute = function() {
  if (this.status !== 'running') return false;
  if (!this.nextCheckTime) return true;
  return new Date() >= this.nextCheckTime;
};

// 实例方法 - 获取启用的关键词
monitorTaskSchema.methods.getEnabledKeywords = function() {
  return this.keywords.filter(k => k.enabled && k.keyword.trim());
};

// 实例方法 - 验证配置
monitorTaskSchema.methods.validateConfig = function() {
  const errors = [];
  
  // 检查关键词
  const enabledKeywords = this.getEnabledKeywords();
  if (enabledKeywords.length === 0) {
    errors.push('至少需要一个启用的关键词');
  }
  
  // 检查价格范围
  if (this.minPrice < 0) errors.push('最低价格不能为负数');
  if (this.maxPrice < 0) errors.push('最高价格不能为负数');
  if (this.minPrice > this.maxPrice) errors.push('最低价格不能高于最高价格');
  
  // 检查预警价格
  if (this.enableAlert && (!this.alertPrice || this.alertPrice <= 0)) {
    errors.push('启用低价预警时必须设置有效的预警价格');
  }
  
  // 检查间隔
  if (this.interval < 10) errors.push('监控间隔不能少于10秒');
  if (this.interval > 3600) errors.push('监控间隔不能超过1小时');
  
  // 检查页数
  if (this.monitorPages < 1) errors.push('监控页数不能少于1页');
  if (this.monitorPages > 10) errors.push('监控页数不能超过10页');
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// 静态方法 - 获取用户的运行任务数
monitorTaskSchema.statics.getRunningTaskCount = function(userId) {
  return this.countDocuments({ userId, status: 'running' });
};

// 静态方法 - 获取需要执行的任务
monitorTaskSchema.statics.getTasksToExecute = function() {
  return this.find({
    status: 'running',
    $or: [
      { nextCheckTime: { $lte: new Date() } },
      { nextCheckTime: { $exists: false } }
    ]
  }).select('+cookie');
};

// 静态方法 - 获取用户统计
monitorTaskSchema.statics.getUserStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalProducts: { $sum: '$stats.totalNewProducts' },
        totalAlerts: { $sum: '$stats.totalLowPriceAlerts' }
      }
    }
  ]);
};

// 静态方法 - 清理过期任务
monitorTaskSchema.statics.cleanupExpiredTasks = function(days = 30) {
  const expiredDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.deleteMany({
    status: { $in: ['stopped', 'error'] },
    updatedAt: { $lt: expiredDate }
  });
};

module.exports = mongoose.model('MonitorTask', monitorTaskSchema);
