const express = require('express');
const Product = require('../models/Product');
const MonitorTask = require('../models/MonitorTask');
const excelUtil = require('../utils/excel');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 获取商品列表
 * GET /api/products
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const {
      taskId,
      keyword,
      minPrice,
      maxPrice,
      isLowPriceAlert,
      status = 'active',
      dateFrom,
      dateTo,
      page = 1,
      limit = 20,
      sortBy = 'foundAt',
      sortOrder = 'desc'
    } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    // 构建查询条件
    let query = {};
    
    // 如果指定了taskId，验证任务归属
    if (taskId) {
      const task = await MonitorTask.findOne({ _id: taskId, userId });
      if (!task) {
        return res.status(404).json({
          success: false,
          message: '任务不存在'
        });
      }
      query.taskId = taskId;
    } else {
      // 如果没有指定taskId，查询用户的所有商品
      const userTasks = await MonitorTask.find({ userId }).select('_id');
      const taskIds = userTasks.map(task => task._id);
      query.taskId = { $in: taskIds };
    }

    // 关键词搜索
    if (keyword) {
      query.$or = [
        { title: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } },
        { sourceKeyword: { $regex: keyword, $options: 'i' } },
        { userName: { $regex: keyword, $options: 'i' } }
      ];
    }

    // 价格过滤
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) query.price.$gte = parseFloat(minPrice);
      if (maxPrice !== undefined) query.price.$lte = parseFloat(maxPrice);
    }

    // 状态过滤
    if (isLowPriceAlert !== undefined) {
      query.isLowPriceAlert = isLowPriceAlert === 'true';
    }
    if (status) query.status = status;

    // 日期过滤
    if (dateFrom || dateTo) {
      query.foundAt = {};
      if (dateFrom) query.foundAt.$gte = new Date(dateFrom);
      if (dateTo) query.foundAt.$lte = new Date(dateTo);
    }

    // 排序
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // 执行查询
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('taskId', 'name keywords')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      Product.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          current: parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取商品列表失败'
    });
  }
});

/**
 * 获取单个商品详情
 * GET /api/products/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const productId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const product = await Product.findById(productId).populate('taskId', 'name keywords userId');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    // 验证商品归属
    if (product.taskId.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: '无权访问此商品'
      });
    }

    // 记录查看操作
    await product.recordAction('view');

    res.json({
      success: true,
      data: {
        product
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取商品详情失败'
    });
  }
});

/**
 * 记录商品操作（点击、收藏等）
 * POST /api/products/:id/action
 */
router.post('/:id/action', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const productId = req.params.id;
    const { action } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const validActions = ['view', 'click', 'favorite', 'share'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: '无效的操作类型'
      });
    }

    const product = await Product.findById(productId).populate('taskId', 'userId');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    // 验证商品归属
    if (product.taskId.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: '无权操作此商品'
      });
    }

    // 记录操作
    await product.recordAction(action);

    res.json({
      success: true,
      message: `操作记录成功: ${action}`,
      data: {
        productId,
        action,
        stats: {
          viewCount: product.viewCount,
          clickCount: product.clickCount,
          favoriteCount: product.favoriteCount
        }
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '记录操作失败'
    });
  }
});

/**
 * 获取商品统计信息
 * GET /api/products/stats/:taskId?
 */
router.get('/stats/:taskId?', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { taskId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    let query = {};
    
    if (taskId) {
      // 验证任务归属
      const task = await MonitorTask.findOne({ _id: taskId, userId });
      if (!task) {
        return res.status(404).json({
          success: false,
          message: '任务不存在'
        });
      }
      query.taskId = taskId;
    } else {
      // 获取用户的所有任务
      const userTasks = await MonitorTask.find({ userId }).select('_id');
      const taskIds = userTasks.map(task => task._id);
      query.taskId = { $in: taskIds };
    }

    // 获取基本统计
    const [overallStats, keywordStats, priceDistribution, recentTrend] = await Promise.all([
      Product.getOverallStats(taskId || null),
      Product.getStatsByKeyword(taskId || null),
      Product.getPriceDistribution(taskId || null),
      Product.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$foundAt"
              }
            },
            totalProducts: { $sum: 1 },
            lowPriceAlerts: {
              $sum: { $cond: ['$isLowPriceAlert', 1, 0] }
            },
            avgPrice: { $avg: '$price' }
          }
        },
        { $sort: { _id: -1 } },
        { $limit: 30 }
      ])
    ]);

    // 获取最近发现的商品
    const recentProducts = await Product.find(query)
      .sort({ foundAt: -1 })
      .limit(10)
      .select('title price sourceKeyword foundAt isLowPriceAlert')
      .populate('taskId', 'name');

    res.json({
      success: true,
      data: {
        overall: overallStats[0] || {
          totalProducts: 0,
          totalLowPriceAlerts: 0,
          avgPrice: 0,
          minPrice: 0,
          maxPrice: 0,
          totalViews: 0,
          totalClicks: 0,
          totalFavorites: 0
        },
        keywordStats,
        priceDistribution,
        recentTrend,
        recentProducts
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取统计信息失败'
    });
  }
});

/**
 * 导出商品数据到Excel
 * POST /api/products/export
 */
router.post('/export', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const {
      taskId,
      isLowPriceAlert,
      dateFrom,
      dateTo,
      keyword,
      minPrice,
      maxPrice,
      includeImages = true,
      includeStats = true
    } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    // 构建查询条件
    let query = {};
    
    if (taskId) {
      const task = await MonitorTask.findOne({ _id: taskId, userId });
      if (!task) {
        return res.status(404).json({
          success: false,
          message: '任务不存在'
        });
      }
      query.taskId = taskId;
    } else {
      const userTasks = await MonitorTask.find({ userId }).select('_id');
      const taskIds = userTasks.map(task => task._id);
      query.taskId = { $in: taskIds };
    }

    // 应用过滤条件
    if (isLowPriceAlert !== undefined) query.isLowPriceAlert = isLowPriceAlert;
    if (keyword) {
      query.$or = [
        { title: { $regex: keyword, $options: 'i' } },
        { sourceKeyword: { $regex: keyword, $options: 'i' } }
      ];
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) query.price.$gte = parseFloat(minPrice);
      if (maxPrice !== undefined) query.price.$lte = parseFloat(maxPrice);
    }
    if (dateFrom || dateTo) {
      query.foundAt = {};
      if (dateFrom) query.foundAt.$gte = new Date(dateFrom);
      if (dateTo) query.foundAt.$lte = new Date(dateTo);
    }

    // 查询商品数据
    const products = await Product.find(query)
      .sort({ foundAt: -1 })
      .populate('taskId', 'name');

    if (products.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有符合条件的商品数据'
      });
    }

    // 生成Excel文件
    const exportOptions = {
      includeImages,
      includeStats,
      isLowPriceAlert: isLowPriceAlert || false,
      sheetName: isLowPriceAlert ? '低价预警商品' : '监控发现商品'
    };

    const result = await excelUtil.createProductExcel(products, exportOptions);

    if (!result.success) {
      throw new Error('Excel生成失败');
    }

    res.json({
      success: true,
      message: '导出成功',
      data: {
        fileName: result.fileName,
        downloadUrl: result.downloadUrl,
        recordCount: result.recordCount,
        fileSize: result.fileSize
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '导出失败'
    });
  }
});

/**
 * 批量标记商品为已导出
 * POST /api/products/mark-exported
 */
router.post('/mark-exported', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { productIds, exportType = 'normal' } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '商品ID列表不能为空'
      });
    }

    // 获取用户的任务ID列表
    const userTasks = await MonitorTask.find({ userId }).select('_id');
    const taskIds = userTasks.map(task => task._id);

    // 批量更新商品导出状态
    const updateField = exportType === 'alert' ? 'exported.alert' : 'exported.normal';
    const result = await Product.updateMany(
      {
        _id: { $in: productIds },
        taskId: { $in: taskIds }
      },
      {
        $set: {
          [updateField]: true,
          'exported.exportedAt': new Date()
        }
      }
    );

    res.json({
      success: true,
      message: '标记成功',
      data: {
        updatedCount: result.modifiedCount,
        exportType
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '标记失败'
    });
  }
});

/**
 * 获取热门关键词
 * GET /api/products/keywords/popular
 */
router.get('/keywords/popular', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { limit = 20 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    // 获取用户的任务
    const userTasks = await MonitorTask.find({ userId }).select('_id');
    const taskIds = userTasks.map(task => task._id);

    // 获取热门关键词
    const popularKeywords = await Product.aggregate([
      { $match: { taskId: { $in: taskIds } } },
      {
        $group: {
          _id: '$sourceKeyword',
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' },
          lowPriceAlerts: {
            $sum: { $cond: ['$isLowPriceAlert', 1, 0] }
          },
          recentCount: {
            $sum: {
              $cond: [
                { $gte: ['$foundAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                1, 0
              ]
            }
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json({
      success: true,
      data: {
        keywords: popularKeywords.map(kw => ({
          keyword: kw._id,
          totalProducts: kw.count,
          avgPrice: Math.round(kw.avgPrice * 100) / 100,
          lowPriceAlerts: kw.lowPriceAlerts,
          recentWeekProducts: kw.recentCount,
          alertRate: ((kw.lowPriceAlerts / kw.count) * 100).toFixed(1)
        }))
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取热门关键词失败'
    });
  }
});

/**
 * 删除商品（软删除）
 * DELETE /api/products/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const productId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const product = await Product.findById(productId).populate('taskId', 'userId');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    // 验证商品归属
    if (product.taskId.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: '无权删除此商品'
      });
    }

    // 软删除（更新状态）
    product.status = 'removed';
    await product.save();

    res.json({
      success: true,
      message: '商品删除成功'
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '删除商品失败'
    });
  }
});

/**
 * 批量删除商品
 * POST /api/products/batch-delete
 */
router.post('/batch-delete', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { productIds } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '商品ID列表不能为空'
      });
    }

    // 获取用户的任务ID列表
    const userTasks = await MonitorTask.find({ userId }).select('_id');
    const taskIds = userTasks.map(task => task._id);

    // 批量软删除
    const result = await Product.updateMany(
      {
        _id: { $in: productIds },
        taskId: { $in: taskIds }
      },
      {
        $set: { status: 'removed' }
      }
    );

    res.json({
      success: true,
      message: '批量删除成功',
      data: {
        deletedCount: result.modifiedCount
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '批量删除失败'
    });
  }
});

module.exports = router;
