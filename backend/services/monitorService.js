const cron = require('node-cron');
const XianyuService = require('./xianyuService');
const MonitorTask = require('../models/MonitorTask');
const Product = require('../models/Product');
const logger = require('../utils/logger');

class MonitorService {
  constructor(io) {
    this.io = io;
    this.xianyuService = new XianyuService();
    this.activeTasks = new Map(); // 存储活动的监控任务
    this.taskTimers = new Map(); // 存储定时器
  }

  /**
   * 启动监控服务
   */
  start() {
    logger.info('监控服务启动中...');
    
    // 恢复之前运行的监控任务
    this.restoreActiveTasks();
    
    // 设置定期清理任务
    this.startCleanupTask();
    
    logger.info('监控服务启动完成');
  }

  /**
   * 停止监控服务
   */
  stop() {
    logger.info('监控服务停止中...');
    
    // 停止所有活动任务
    for (const [taskId, task] of this.activeTasks) {
      this.stopMonitorTask(taskId);
    }
    
    // 清理定时器
    for (const [taskId, timer] of this.taskTimers) {
      clearInterval(timer);
    }
    
    this.activeTasks.clear();
    this.taskTimers.clear();
    
    logger.info('监控服务已停止');
  }

  /**
   * 开始监控任务
   * @param {string} taskId - 任务ID
   * @param {object} taskData - 任务数据
   */
  async startMonitorTask(taskId, taskData) {
    try {
      // 检查是否已经在运行
      if (this.activeTasks.has(taskId)) {
        logger.warn(`监控任务 ${taskId} 已在运行中`);
        return { success: false, message: '任务已在运行中' };
      }

      // 验证任务数据
      const validationResult = this.validateTaskData(taskData);
      if (!validationResult.valid) {
        return { success: false, message: validationResult.message };
      }

      // 创建任务实例
      const task = {
        id: taskId,
        userId: taskData.userId,
        keywords: taskData.keywords,
        interval: taskData.interval * 1000, // 转换为毫秒
        monitorPages: taskData.monitorPages,
        minPrice: taskData.minPrice,
        maxPrice: taskData.maxPrice,
        alertPrice: taskData.alertPrice,
        enableAlert: taskData.enableAlert,
        cookie: taskData.cookie,
        isRunning: true,
        createdAt: new Date(),
        lastCheckTime: null,
        foundItemIds: new Set(),
        lowPriceItemIds: new Set(),
        stats: {
          totalRounds: 0,
          totalProductsChecked: 0,
          totalNewProducts: 0,
          totalLowPriceAlerts: 0
        }
      };

      // 保存到活动任务列表
      this.activeTasks.set(taskId, task);

      // 更新数据库中的任务状态
      await MonitorTask.findByIdAndUpdate(taskId, {
        status: 'running',
        startTime: new Date()
      });

      // 立即执行一次监控
      this.executeMonitorRound(taskId);

      // 设置定时监控
      const timer = setInterval(() => {
        if (this.activeTasks.has(taskId) && this.activeTasks.get(taskId).isRunning) {
          this.executeMonitorRound(taskId);
        }
      }, task.interval);

      this.taskTimers.set(taskId, timer);

      // 发送启动通知
      this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'taskStarted', {
        taskId,
        message: '监控任务已启动',
        keywords: task.keywords,
        interval: taskData.interval,
        timestamp: new Date().toISOString()
      });

      logger.info(`监控任务 ${taskId} 启动成功，用户: ${task.userId}`);

      return { success: true, message: '监控任务启动成功' };

    } catch (error) {
      logger.error(`启动监控任务 ${taskId} 失败:`, error);
      return { success: false, message: error.message };
    }
  }

  /**
   * 停止监控任务
   * @param {string} taskId - 任务ID
   */
  async stopMonitorTask(taskId) {
    try {
      const task = this.activeTasks.get(taskId);
      if (!task) {
        return { success: false, message: '任务不存在' };
      }

      // 停止任务
      task.isRunning = false;

      // 清理定时器
      if (this.taskTimers.has(taskId)) {
        clearInterval(this.taskTimers.get(taskId));
        this.taskTimers.delete(taskId);
      }

      // 更新数据库中的任务状态
      await MonitorTask.findByIdAndUpdate(taskId, {
        status: 'stopped',
        stopTime: new Date(),
        stats: {
          totalRounds: task.stats.totalRounds,
          totalProductsChecked: task.stats.totalProductsChecked,
          totalNewProducts: task.stats.totalNewProducts,
          totalLowPriceAlerts: task.stats.totalLowPriceAlerts
        }
      });

      // 发送停止通知
      this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'taskStopped', {
        taskId,
        message: '监控任务已停止',
        stats: task.stats,
        timestamp: new Date().toISOString()
      });

      // 从活动任务列表中移除
      this.activeTasks.delete(taskId);

      logger.info(`监控任务 ${taskId} 已停止`);

      return { success: true, message: '监控任务已停止' };

    } catch (error) {
      logger.error(`停止监控任务 ${taskId} 失败:`, error);
      return { success: false, message: error.message };
    }
  }

  /**
   * 执行一轮监控
   * @param {string} taskId - 任务ID
   */
  async executeMonitorRound(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task || !task.isRunning) {
      return;
    }

    try {
      logger.info(`开始执行监控任务 ${taskId} - 第 ${task.stats.totalRounds + 1} 轮`);

      task.stats.totalRounds++;
      task.lastCheckTime = new Date();

      // 发送监控开始通知
      this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'monitorRoundStart', {
        taskId,
        roundNumber: task.stats.totalRounds,
        keywords: task.keywords,
        timestamp: new Date().toISOString()
      });

      const roundResults = {
        newProducts: [],
        lowPriceAlerts: [],
        totalChecked: 0
      };

      // 遍历所有关键词
      for (let i = 0; i < task.keywords.length; i++) {
        const keywordData = task.keywords[i];
        if (!keywordData.enabled) continue;

        const keyword = keywordData.keyword;
        
        this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'keywordStart', {
          taskId,
          keyword,
          index: i + 1,
          total: task.keywords.length,
          timestamp: new Date().toISOString()
        });

        // 搜索该关键词的商品
        const searchResult = await this.xianyuService.searchProducts({
          keyword,
          pages: task.monitorPages,
          cookie: task.cookie,
          minPrice: task.minPrice,
          maxPrice: task.maxPrice
        });

        if (searchResult.success) {
          task.stats.totalProductsChecked += searchResult.totalChecked;
          roundResults.totalChecked += searchResult.totalChecked;

          // 处理搜索结果
          for (const product of searchResult.results) {
            const itemId = product.itemId;
            
            // 检查是否是新商品
            if (task.foundItemIds.has(itemId) || task.lowPriceItemIds.has(itemId)) {
              continue;
            }

            const price = this.xianyuService.parsePrice(product.price);

            // 检查低价预警
            if (task.enableAlert && task.alertPrice && price > 0 && price <= task.alertPrice) {
              product.sourceKeyword = keyword;
              product.alertPrice = task.alertPrice;
              roundResults.lowPriceAlerts.push(product);
              task.lowPriceItemIds.add(itemId);
              task.stats.totalLowPriceAlerts++;
            } 
            // 检查是否在价格范围内
            else if (this.xianyuService.isPriceInRange(product.price, task.minPrice, task.maxPrice)) {
              product.sourceKeyword = keyword;
              roundResults.newProducts.push(product);
              task.foundItemIds.add(itemId);
              task.stats.totalNewProducts++;
            }
          }

          this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'keywordComplete', {
            taskId,
            keyword,
            productsChecked: searchResult.totalChecked,
            newProducts: roundResults.newProducts.filter(p => p.sourceKeyword === keyword).length,
            lowPriceAlerts: roundResults.lowPriceAlerts.filter(p => p.sourceKeyword === keyword).length,
            timestamp: new Date().toISOString()
          });

        } else {
          // 搜索失败处理
          this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'keywordError', {
            taskId,
            keyword,
            error: searchResult.error,
            timestamp: new Date().toISOString()
          });

          // 如果是token过期，停止整个任务
          if (searchResult.errors?.some(e => e.error === 'TOKEN_EXPIRED')) {
            this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'taskError', {
              taskId,
              error: 'TOKEN_EXPIRED',
              message: 'Token已过期，监控任务自动停止',
              timestamp: new Date().toISOString()
            });
            await this.stopMonitorTask(taskId);
            return;
          }
        }

        // 关键词间延迟
        if (i < task.keywords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // 保存发现的商品
      if (roundResults.newProducts.length > 0 || roundResults.lowPriceAlerts.length > 0) {
        await this.saveDiscoveredProducts(taskId, roundResults);
      }

      // 发送监控完成通知
      this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'monitorRoundComplete', {
        taskId,
        roundNumber: task.stats.totalRounds,
        totalChecked: roundResults.totalChecked,
        newProducts: roundResults.newProducts.length,
        lowPriceAlerts: roundResults.lowPriceAlerts.length,
        stats: task.stats,
        nextCheckTime: new Date(Date.now() + task.interval).toISOString(),
        timestamp: new Date().toISOString()
      });

      // 发送新商品通知
      if (roundResults.newProducts.length > 0) {
        this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'newProductsFound', {
          taskId,
          products: roundResults.newProducts.slice(0, 5), // 只发送前5个
          total: roundResults.newProducts.length,
          timestamp: new Date().toISOString()
        });
      }

      // 发送低价预警通知
      if (roundResults.lowPriceAlerts.length > 0) {
        this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'lowPriceAlert', {
          taskId,
          products: roundResults.lowPriceAlerts.slice(0, 5), // 只发送前5个
          total: roundResults.lowPriceAlerts.length,
          alertPrice: task.alertPrice,
          timestamp: new Date().toISOString()
        });
      }

      logger.info(`监控任务 ${taskId} 第 ${task.stats.totalRounds} 轮完成: 检查 ${roundResults.totalChecked} 个商品, 新商品 ${roundResults.newProducts.length} 个, 低价预警 ${roundResults.lowPriceAlerts.length} 个`);

    } catch (error) {
      logger.error(`执行监控任务 ${taskId} 时发生错误:`, error);
      
      this.emitToRoom(`monitor_${task.userId}_${taskId}`, 'monitorError', {
        taskId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 保存发现的商品
   * @param {string} taskId - 任务ID
   * @param {object} results - 搜索结果
   */
  async saveDiscoveredProducts(taskId, results) {
    try {
      const products = [...results.newProducts, ...results.lowPriceAlerts];
      
      for (const product of products) {
        await Product.create({
          taskId,
          userId: task.userId,
          itemId: product.itemId,
          title: product.description,
          price: this.xianyuService.parsePrice(product.price),
          priceStr: product.price,
          userName: product.userName,
          area: product.area,
          url: product.url,
          picUrl: product.picUrl,
          allImages: product.allImages,
          sourceKeyword: product.sourceKeyword,
          isLowPriceAlert: results.lowPriceAlerts.includes(product),
          alertPrice: product.alertPrice,
          foundAt: new Date()
        });
      }

      logger.info(`保存了 ${products.length} 个商品到数据库`);
    } catch (error) {
      logger.error('保存商品数据时发生错误:', error);
    }
  }

  /**
   * 验证任务数据
   * @param {object} taskData - 任务数据
   * @returns {object} - 验证结果
   */
  validateTaskData(taskData) {
    if (!taskData.userId) {
      return { valid: false, message: '缺少用户ID' };
    }

    if (!taskData.cookie || !taskData.cookie.trim()) {
      return { valid: false, message: 'Cookie不能为空' };
    }

    if (!Array.isArray(taskData.keywords) || taskData.keywords.length === 0) {
      return { valid: false, message: '至少需要一个关键词' };
    }

    const enabledKeywords = taskData.keywords.filter(k => k.enabled && k.keyword?.trim());
    if (enabledKeywords.length === 0) {
      return { valid: false, message: '至少需要启用一个关键词' };
    }

    if (!taskData.interval || taskData.interval < 10) {
      return { valid: false, message: '监控间隔不能小于10秒' };
    }

    if (!taskData.monitorPages || taskData.monitorPages < 1 || taskData.monitorPages > 10) {
      return { valid: false, message: '监控页数必须在1-10之间' };
    }

    return { valid: true };
  }

  /**
   * 恢复之前运行的监控任务
   */
  async restoreActiveTasks() {
    try {
      const runningTasks = await MonitorTask.find({ status: 'running' });
      
      for (const dbTask of runningTasks) {
        // 将数据库中的任务数据转换为运行时格式
        const taskData = {
          userId: dbTask.userId,
          keywords: dbTask.keywords,
          interval: dbTask.interval,
          monitorPages: dbTask.monitorPages,
          minPrice: dbTask.minPrice,
          maxPrice: dbTask.maxPrice,
          alertPrice: dbTask.alertPrice,
          enableAlert: dbTask.enableAlert,
          cookie: dbTask.cookie
        };

        // 重新启动任务
        await this.startMonitorTask(dbTask._id.toString(), taskData);
      }

      logger.info(`恢复了 ${runningTasks.length} 个监控任务`);
    } catch (error) {
      logger.error('恢复监控任务时发生错误:', error);
    }
  }

  /**
   * 启动定期清理任务
   */
  startCleanupTask() {
    // 每天凌晨2点执行清理任务
    cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('开始执行定期清理任务...');
        
        // 清理30天前的商品记录
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const deletedCount = await Product.deleteMany({ 
          foundAt: { $lt: thirtyDaysAgo } 
        });
        
        logger.info(`清理了 ${deletedCount.deletedCount} 条过期商品记录`);
        
        // 清理已停止的监控任务（7天前）
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const deletedTasks = await MonitorTask.deleteMany({
          status: 'stopped',
          stopTime: { $lt: sevenDaysAgo }
        });
        
        logger.info(`清理了 ${deletedTasks.deletedCount} 个过期监控任务`);
        
      } catch (error) {
        logger.error('执行清理任务时发生错误:', error);
      }
    });
    
    logger.info('定期清理任务已设置完成');
  }

  /**
   * 向指定房间发送消息
   * @param {string} room - 房间名
   * @param {string} event - 事件名
   * @param {object} data - 数据
   */
  emitToRoom(room, event, data) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  /**
   * 获取监控任务状态
   * @param {string} taskId - 任务ID
   * @returns {object} - 任务状态
   */
  getTaskStatus(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return { running: false };
    }

    return {
      running: task.isRunning,
      stats: task.stats,
      lastCheckTime: task.lastCheckTime,
      nextCheckTime: task.lastCheckTime ? 
        new Date(task.lastCheckTime.getTime() + task.interval) : 
        null,
      keywords: task.keywords.map(k => ({
        keyword: k.keyword,
        enabled: k.enabled
      }))
    };
  }

  /**
   * 获取所有活动任务
   * @returns {Array} - 活动任务列表
   */
  getActiveTasks() {
    const tasks = [];
    for (const [taskId, task] of this.activeTasks) {
      tasks.push({
        id: taskId,
        userId: task.userId,
        keywords: task.keywords,
        stats: task.stats,
        lastCheckTime: task.lastCheckTime,
        isRunning: task.isRunning
      });
    }
    return tasks;
  }
}

module.exports = MonitorService;
