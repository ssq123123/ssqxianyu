const express = require('express');
const MonitorTask = require('../models/MonitorTask');
const User = require('../models/User');
const MonitorService = require('../services/monitorService');
const cryptoUtil = require('../utils/crypto');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 创建监控任务
 * POST /api/monitor/tasks
 */
router.post('/tasks', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskData = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    // 获取用户信息检查权限
    const user = await User.findById(userId).select('+cookie');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 检查用户是否有Cookie
    if (!user.cookie || user.isCookieExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Cookie未设置或已过期，请先更新Cookie',
        code: 'COOKIE_REQUIRED'
      });
    }

    // 检查用户权限
    const runningTaskCount = await MonitorTask.getRunningTaskCount(userId);
    if (!user.checkPermission('maxTasks')) {
      return res.status(403).json({
        success: false,
        message: `最多只能创建 ${user.membership.features.maxTasks} 个监控任务，当前运行 ${runningTaskCount} 个`,
        code: 'TASK_LIMIT_EXCEEDED'
      });
    }

    // 验证关键词数量
    const enabledKeywords = taskData.keywords?.filter(k => k.enabled && k.keyword?.trim()) || [];
    if (!user.checkPermission('maxKeywords', enabledKeywords.length)) {
      return res.status(403).json({
        success: false,
        message: `每个任务最多 ${user.membership.features.maxKeywordsPerTask} 个关键词`,
        code: 'KEYWORD_LIMIT_EXCEEDED'
      });
    }

    // 验证监控页数
    if (!user.checkPermission('maxPages', taskData.monitorPages)) {
      return res.status(403).json({
        success: false,
        message: `最多监控 ${user.membership.features.maxMonitorPages} 页`,
        code: 'PAGE_LIMIT_EXCEEDED'
      });
    }

    // 解密Cookie
    const decryptedCookie = cryptoUtil.decryptSimple(user.cookie);

    // 创建任务
    const task = new MonitorTask({
      userId,
      name: taskData.name,
      description: taskData.description,
      keywords: taskData.keywords.map(k => ({
        keyword: k.keyword?.trim(),
        enabled: k.enabled || false,
        priority: k.priority || 1
      })),
      interval: taskData.interval || 30,
      monitorPages: taskData.monitorPages || 3,
      minPrice: taskData.minPrice || 0,
      maxPrice: taskData.maxPrice || 999999,
      enableAlert: taskData.enableAlert || false,
      alertPrice: taskData.alertPrice,
      cookie: cryptoUtil.encryptSimple(decryptedCookie), // 重新加密存储
      options: {
        multiImages: taskData.options?.multiImages !== false,
        soundAlert: taskData.options?.soundAlert !== false,
        autoExport: taskData.options?.autoExport || false,
        exportFormat: taskData.options?.exportFormat || 'excel'
      },
      export: {
        normalFile: taskData.export?.normalFile || `监控结果_${taskData.name}.xlsx`,
        alertFile: taskData.export?.alertFile || `低价预警_${taskData.name}.xlsx`
      }
    });

    // 验证任务配置
    const validation = task.validateConfig();
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: '任务配置验证失败',
        errors: validation.errors
      });
    }

    await task.save();

    // 更新用户统计
    await user.incrementTaskCount();

    logger.monitor.taskStart(task._id, userId, task.keywords);

    res.status(201).json({
      success: true,
      message: '监控任务创建成功',
      data: {
        task: {
          id: task._id,
          name: task.name,
          description: task.description,
          keywords: task.keywords,
          interval: task.interval,
          monitorPages: task.monitorPages,
          minPrice: task.minPrice,
          maxPrice: task.maxPrice,
          enableAlert: task.enableAlert,
          alertPrice: task.alertPrice,
          options: task.options,
          status: task.status,
          createdAt: task.createdAt
        }
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '创建监控任务失败'
    });
  }
});

/**
 * 获取用户的监控任务列表
 * GET /api/monitor/tasks
 */
router.get('/tasks', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { page = 1, limit = 10, status, keyword } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const query = { userId };
    if (status) query.status = status;
    if (keyword) {
      query.$or = [
        { name: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } },
        { 'keywords.keyword': { $regex: keyword, $options: 'i' } }
      ];
    }

    const [tasks, total] = await Promise.all([
      MonitorTask.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .select('-cookie'),
      MonitorTask.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        tasks,
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
      message: '获取任务列表失败'
    });
  }
});

/**
 * 获取单个监控任务详情
 * GET /api/monitor/tasks/:id
 */
router.get('/tasks/:id', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const task = await MonitorTask.findOne({ _id: taskId, userId }).select('-cookie');
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    // 获取运行时状态（如果任务正在运行）
    let runtimeStatus = null;
    if (req.app.locals.monitorService) {
      runtimeStatus = req.app.locals.monitorService.getTaskStatus(taskId);
    }

    res.json({
      success: true,
      data: {
        task,
        runtime: runtimeStatus
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取任务详情失败'
    });
  }
});

/**
 * 更新监控任务
 * PUT /api/monitor/tasks/:id
 */
router.put('/tasks/:id', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;
    const updateData = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const task = await MonitorTask.findOne({ _id: taskId, userId });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    // 如果任务正在运行，不允许修改
    if (task.status === 'running') {
      return res.status(400).json({
        success: false,
        message: '任务正在运行中，请先停止任务后再修改'
      });
    }

    // 获取用户权限检查
    const user = await User.findById(userId);
    const enabledKeywords = updateData.keywords?.filter(k => k.enabled && k.keyword?.trim()) || task.getEnabledKeywords();
    
    if (!user.checkPermission('maxKeywords', enabledKeywords.length)) {
      return res.status(403).json({
        success: false,
        message: `每个任务最多 ${user.membership.features.maxKeywordsPerTask} 个关键词`
      });
    }

    if (updateData.monitorPages && !user.checkPermission('maxPages', updateData.monitorPages)) {
      return res.status(403).json({
        success: false,
        message: `最多监控 ${user.membership.features.maxMonitorPages} 页`
      });
    }

    // 更新任务字段
    const allowedFields = [
      'name', 'description', 'keywords', 'interval', 'monitorPages',
      'minPrice', 'maxPrice', 'enableAlert', 'alertPrice', 'options', 'export'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field === 'keywords') {
          task[field] = updateData[field].map(k => ({
            keyword: k.keyword?.trim(),
            enabled: k.enabled || false,
            priority: k.priority || 1
          }));
        } else {
          task[field] = updateData[field];
        }
      }
    });

    // 验证更新后的配置
    const validation = task.validateConfig();
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: '任务配置验证失败',
        errors: validation.errors
      });
    }

    await task.save();

    logger.info(`任务 ${taskId} 配置已更新`);

    res.json({
      success: true,
      message: '任务更新成功',
      data: {
        task: task.toJSON()
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '更新任务失败'
    });
  }
});

/**
 * 启动监控任务
 * POST /api/monitor/tasks/:id/start
 */
router.post('/tasks/:id/start', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    // 获取任务和用户信息
    const [task, user] = await Promise.all([
      MonitorTask.findOne({ _id: taskId, userId }).select('+cookie'),
      User.findById(userId).select('+cookie')
    ]);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    if (task.status === 'running') {
      return res.status(400).json({
        success: false,
        message: '任务已在运行中'
      });
    }

    // 检查用户Cookie状态
    if (!user.cookie || user.isCookieExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Cookie未设置或已过期，请先更新Cookie',
        code: 'COOKIE_REQUIRED'
      });
    }

    // 检查运行任务数量限制
    const runningTaskCount = await MonitorTask.getRunningTaskCount(userId);
    if (!user.checkPermission('maxTasks')) {
      return res.status(403).json({
        success: false,
        message: `最多只能同时运行 ${user.membership.features.maxTasks} 个任务`
      });
    }

    // 验证任务配置
    const validation = task.validateConfig();
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: '任务配置有误，请修改后重试',
        errors: validation.errors
      });
    }

    // 准备监控服务数据
    const decryptedCookie = cryptoUtil.decryptSimple(user.cookie);
    const taskData = {
      userId,
      keywords: task.getEnabledKeywords(),
      interval: task.interval,
      monitorPages: task.monitorPages,
      minPrice: task.minPrice,
      maxPrice: task.maxPrice,
      alertPrice: task.alertPrice,
      enableAlert: task.enableAlert,
      cookie: decryptedCookie
    };

    // 启动监控服务
    const monitorService = req.app.locals.monitorService;
    if (!monitorService) {
      throw new Error('监控服务未初始化');
    }

    const result = await monitorService.startMonitorTask(taskId, taskData);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      message: '监控任务启动成功',
      data: {
        taskId,
        status: 'running',
        startTime: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '启动监控任务失败'
    });
  }
});

/**
 * 停止监控任务
 * POST /api/monitor/tasks/:id/stop
 */
router.post('/tasks/:id/stop', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const task = await MonitorTask.findOne({ _id: taskId, userId });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    if (task.status !== 'running') {
      return res.status(400).json({
        success: false,
        message: '任务未在运行中'
      });
    }

    // 停止监控服务
    const monitorService = req.app.locals.monitorService;
    if (monitorService) {
      const result = await monitorService.stopMonitorTask(taskId);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }
    }

    // 更新用户统计
    const user = await User.findById(userId);
    await user.decrementRunningTaskCount();

    res.json({
      success: true,
      message: '监控任务已停止',
      data: {
        taskId,
        status: 'stopped',
        stopTime: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '停止监控任务失败'
    });
  }
});

/**
 * 暂停/恢复监控任务
 * POST /api/monitor/tasks/:id/pause
 */
router.post('/tasks/:id/pause', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const task = await MonitorTask.findOne({ _id: taskId, userId });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    let newStatus;
    let message;

    if (task.status === 'running') {
      await task.pause();
      newStatus = 'paused';
      message = '任务已暂停';
    } else if (task.status === 'paused') {
      await task.resume();
      newStatus = 'running';
      message = '任务已恢复';
    } else {
      return res.status(400).json({
        success: false,
        message: '任务状态不支持此操作'
      });
    }

    res.json({
      success: true,
      message,
      data: {
        taskId,
        status: newStatus
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '操作失败'
    });
  }
});

/**
 * 删除监控任务
 * DELETE /api/monitor/tasks/:id
 */
router.delete('/tasks/:id', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const task = await MonitorTask.findOne({ _id: taskId, userId });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    // 如果任务正在运行，先停止
    if (task.status === 'running') {
      const monitorService = req.app.locals.monitorService;
      if (monitorService) {
        await monitorService.stopMonitorTask(taskId);
      }
      
      // 更新用户统计
      const user = await User.findById(userId);
      await user.decrementRunningTaskCount();
    }

    // 删除任务
    await MonitorTask.findByIdAndDelete(taskId);

    // 删除相关的商品记录（可选，也可以保留用于历史查询）
    const Product = require('../models/Product');
    await Product.deleteMany({ taskId });

    logger.info(`任务 ${taskId} 已删除`);

    res.json({
      success: true,
      message: '任务删除成功'
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '删除任务失败'
    });
  }
});

/**
 * 获取任务运行状态
 * GET /api/monitor/tasks/:id/status
 */
router.get('/tasks/:id/status', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const taskId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const task = await MonitorTask.findOne({ _id: taskId, userId }).select('-cookie');
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    // 获取运行时状态
    let runtimeStatus = { running: false };
    const monitorService = req.app.locals.monitorService;
    if (monitorService) {
      runtimeStatus = monitorService.getTaskStatus(taskId);
    }

    res.json({
      success: true,
      data: {
        taskId,
        dbStatus: task.status,
        runtime: runtimeStatus,
        stats: task.stats,
        lastCheckTime: task.lastCheckTime,
        nextCheckTime: task.nextCheckTime,
        lastError: task.lastError
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取任务状态失败'
    });
  }
});

/**
 * 获取所有活动的监控任务状态
 * GET /api/monitor/status
 */
router.get('/status', async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    // 获取用户的运行中任务
    const runningTasks = await MonitorTask.find({ 
      userId, 
      status: 'running' 
    }).select('name status stats lastCheckTime nextCheckTime lastError');

    // 获取运行时状态
    const monitorService = req.app.locals.monitorService;
    const activeTasks = monitorService ? monitorService.getActiveTasks() : [];
    
    // 合并状态信息
    const taskStatuses = runningTasks.map(task => {
      const runtime = activeTasks.find(active => active.id === task._id.toString());
      return {
        id: task._id,
        name: task.name,
        status: task.status,
        stats: task.stats,
        lastCheckTime: task.lastCheckTime,
        nextCheckTime: task.nextCheckTime,
        lastError: task.lastError,
        runtime: runtime ? {
          running: runtime.isRunning,
          stats: runtime.stats,
          lastCheckTime: runtime.lastCheckTime
        } : null
      };
    });

    res.json({
      success: true,
      data: {
        totalTasks: runningTasks.length,
        activeTasks: activeTasks.filter(t => t.userId === userId).length,
        tasks: taskStatuses
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取监控状态失败'
    });
  }
});

module.exports = router;
