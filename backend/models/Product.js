const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  // 关联信息
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MonitorTask',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  
  // 闲鱼商品基本信息
  itemId: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  
  // 价格信息
  price: {
    type: Number,
    required: true,
    min: 0
  },
  priceStr: {
    type: String,
    required: true
  },
  
  // 卖家信息
  userName: {
    type: String,
    required: true,
    trim: true
  },
  area: {
    type: String,
    required: true,
    trim: true
  },
  
  // 链接和图片
  url: {
    type: String,
    required: true
  },
  picUrl: {
    type: String,
    required: true
  },
  allImages: [{
    type: String
  }],
  localImages: [{
    type: String
  }],
  
  // 搜索来源
  sourceKeyword: {
    type: String,
    required: true,
    trim: true
  },
  sourcePage: {
    type: Number,
    default: 1
  },
  
  // 预警信息
  isLowPriceAlert: {
    type: Boolean,
    default: false,
    index: true
  },
  alertPrice: {
    type: Number,
    min: 0
  },
  
  // 商品状态
  status: {
    type: String,
    enum: ['active', 'sold', 'removed', 'expired'],
    default: 'active',
    index: true
  },
  
  // 跟踪信息
  viewCount: {
    type: Number,
    default: 0
  },
  clickCount: {
    type: Number,
    default: 0
  },
  favoriteCount: {
    type: Number,
    default: 0
  },
  
  // 标签和分类
  tags: [{
    type: String,
    trim: true
  }],
  category: {
    type: String,
    trim: true
  },
  
  // 商品特征（用于去重和分析）
  fingerprint: {
    type: String,
    index: true
  },
  similarity: {
    titleHash: String,
    imageHash: String,
    priceRange: String
  },
  
  // 价格历史
  priceHistory: [{
    price: Number,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  // 发现时间
  foundAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // 最后检查时间
  lastCheckedAt: {
    type: Date,
    default: Date.now
  },
  
  // 导出状态
  exported: {
    normal: {
      type: Boolean,
      default: false
    },
    alert: {
      type: Boolean,
      default: false
    },
    exportedAt: Date
  },
  
  // 用户交互
  userActions: {
    viewed: {
      type: Boolean,
      default: false
    },
    clicked: {
      type: Boolean,
      default: false
    },
    favorited: {
      type: Boolean,
      default: false
    },
    shared: {
      type: Boolean,
      default: false
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
  timestamps: true
});

// 复合索引
productSchema.index({ taskId: 1, foundAt: -1 });
productSchema.index({ userId: 1, foundAt: -1 });
productSchema.index({ sourceKeyword: 1, foundAt: -1 });
productSchema.index({ isLowPriceAlert: 1, foundAt: -1 });
productSchema.index({ status: 1, foundAt: -1 });
productSchema.index({ fingerprint: 1 }, { sparse: true });

// 唯一约束 - 同一任务下的商品不重复
productSchema.index({ taskId: 1, itemId: 1 }, { unique: true });

// 虚拟字段 - 是否为新商品
productSchema.virtual('isNew').get(function() {
  const hoursSinceFound = (Date.now() - this.foundAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceFound <= 24;
});

// 虚拟字段 - 价格趋势
productSchema.virtual('priceTrend').get(function() {
  if (this.priceHistory.length < 2) return 'stable';
  
  const latest = this.priceHistory[this.priceHistory.length - 1];
  const previous = this.priceHistory[this.priceHistory.length - 2];
  
  if (latest.price > previous.price) return 'up';
  if (latest.price < previous.price) return 'down';
  return 'stable';
});

// 虚拟字段 - 性价比评分
productSchema.virtual('valueScore').get(function() {
  // 简单的性价比计算，可以根据需要调整
  const baseScore = 50;
  const priceScore = Math.max(0, 50 - (this.price / 100)); // 价格越低分数越高
  const alertScore = this.isLowPriceAlert ? 30 : 0; // 低价预警额外加分
  const freshScore = this.isNew ? 20 : 0; // 新商品额外加分
  
  return Math.min(100, baseScore + priceScore + alertScore + freshScore);
});

// 中间件 - 保存前生成指纹
productSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // 生成商品指纹（用于去重）
  if (!this.fingerprint) {
    const crypto = require('crypto');
    const content = `${this.title}-${this.userName}-${this.price}`;
    this.fingerprint = crypto.createHash('md5').update(content).digest('hex');
  }
  
  // 生成相似性哈希
  if (!this.similarity.titleHash) {
    const crypto = require('crypto');
    this.similarity.titleHash = crypto.createHash('md5')
      .update(this.title.toLowerCase().replace(/\s+/g, ''))
      .digest('hex');
  }
  
  // 价格区间
  this.similarity.priceRange = this.getPriceRange(this.price);
  
  next();
});

// 实例方法 - 获取价格区间
productSchema.methods.getPriceRange = function(price) {
  if (price < 50) return '0-50';
  if (price < 100) return '50-100';
  if (price < 200) return '100-200';
  if (price < 500) return '200-500';
  if (price < 1000) return '500-1000';
  return '1000+';
};

// 实例方法 - 记录用户操作
productSchema.methods.recordAction = function(action) {
  switch (action) {
    case 'view':
      this.viewCount += 1;
      this.userActions.viewed = true;
      break;
    case 'click':
      this.clickCount += 1;
      this.userActions.clicked = true;
      break;
    case 'favorite':
      this.favoriteCount += 1;
      this.userActions.favorited = true;
      break;
    case 'share':
      this.userActions.shared = true;
      break;
  }
  this.lastCheckedAt = new Date();
  return this.save();
};

// 实例方法 - 添加价格历史
productSchema.methods.addPriceHistory = function(price) {
  this.priceHistory.push({
    price: price,
    timestamp: new Date()
  });
  
  // 保持最多50条价格历史记录
  if (this.priceHistory.length > 50) {
    this.priceHistory = this.priceHistory.slice(-50);
  }
  
  // 更新当前价格
  this.price = price;
  this.lastCheckedAt = new Date();
  
  return this.save();
};

// 实例方法 - 标记为已导出
productSchema.methods.markExported = function(type = 'normal') {
  if (type === 'alert') {
    this.exported.alert = true;
  } else {
    this.exported.normal = true;
  }
  this.exported.exportedAt = new Date();
  return this.save();
};

// 实例方法 - 检查是否重复
productSchema.methods.checkDuplicate = async function() {
  const duplicates = await this.constructor.find({
    taskId: this.taskId,
    fingerprint: this.fingerprint,
    _id: { $ne: this._id }
  });
  return duplicates.length > 0;
};

// 静态方法 - 按关键词统计
productSchema.statics.getStatsByKeyword = function(taskId) {
  return this.aggregate([
    { $match: { taskId: mongoose.Types.ObjectId(taskId) } },
    {
      $group: {
        _id: '$sourceKeyword',
        totalProducts: { $sum: 1 },
        lowPriceAlerts: {
          $sum: { $cond: ['$isLowPriceAlert', 1, 0] }
        },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' }
      }
    },
    { $sort: { totalProducts: -1 } }
  ]);
};

// 静态方法 - 获取价格分布
productSchema.statics.getPriceDistribution = function(taskId) {
  return this.aggregate([
    { $match: { taskId: mongoose.Types.ObjectId(taskId) } },
    {
      $bucket: {
        groupBy: '$price',
        boundaries: [0, 50, 100, 200, 500, 1000, 5000],
        default: '5000+',
        output: {
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' }
        }
      }
    }
  ]);
};

// 静态方法 - 搜索商品
productSchema.statics.searchProducts = function(taskId, options = {}) {
  const {
    keyword,
    minPrice,
    maxPrice,
    isLowPriceAlert,
    status,
    dateFrom,
    dateTo,
    page = 1,
    limit = 20,
    sort = { foundAt: -1 }
  } = options;
  
  const query = { taskId: mongoose.Types.ObjectId(taskId) };
  
  // 关键词搜索
  if (keyword) {
    query.$or = [
      { title: { $regex: keyword, $options: 'i' } },
      { sourceKeyword: { $regex: keyword, $options: 'i' } },
      { userName: { $regex: keyword, $options: 'i' } }
    ];
  }
  
  // 价格过滤
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.price = {};
    if (minPrice !== undefined) query.price.$gte = minPrice;
    if (maxPrice !== undefined) query.price.$lte = maxPrice;
  }
  
  // 状态过滤
  if (isLowPriceAlert !== undefined) query.isLowPriceAlert = isLowPriceAlert;
  if (status) query.status = status;
  
  // 日期过滤
  if (dateFrom || dateTo) {
    query.foundAt = {};
    if (dateFrom) query.foundAt.$gte = new Date(dateFrom);
    if (dateTo) query.foundAt.$lte = new Date(dateTo);
  }
  
  return this.find(query)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('taskId', 'name keywords');
};

// 静态方法 - 获取热门关键词
productSchema.statics.getPopularKeywords = function(limit = 10) {
  return this.aggregate([
    {
      $group: {
        _id: '$sourceKeyword',
        count: { $sum: 1 },
        avgPrice: { $avg: '$price' },
        lowPriceAlerts: {
          $sum: { $cond: ['$isLowPriceAlert', 1, 0] }
        }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
};

// 静态方法 - 清理过期商品
productSchema.statics.cleanupExpiredProducts = function(days = 30) {
  const expiredDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.deleteMany({
    foundAt: { $lt: expiredDate }
  });
};

// 静态方法 - 获取统计信息
productSchema.statics.getOverallStats = function(taskId) {
  return this.aggregate([
    { $match: { taskId: mongoose.Types.ObjectId(taskId) } },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalLowPriceAlerts: {
          $sum: { $cond: ['$isLowPriceAlert', 1, 0] }
        },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
        totalViews: { $sum: '$viewCount' },
        totalClicks: { $sum: '$clickCount' },
        totalFavorites: { $sum: '$favoriteCount' }
      }
    }
  ]);
};

module.exports = mongoose.model('Product', productSchema);
