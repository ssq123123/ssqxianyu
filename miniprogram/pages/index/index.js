const api = require('../../utils/api');
const storage = require('../../utils/storage');
const { joinMonitor, leaveMonitor, onSocketEvent, offSocketEvent, getSocketStatus } = require('../../utils/socket');

Page({
  data: {
    // 系统信息
    statusBarHeight: 0,
    navigationBarHeight: 44,
    
    // 用户信息
    userInfo: null,
    isLogin: false,
    
    // 监控状态
    monitorTasks: [],
    activeTaskCount: 0,
    totalProductsFound: 0,
    totalLowPriceAlerts: 0,
    
    // 统计数据
    todayStats: {
      newProducts: 0,
      lowPriceAlerts: 0,
      completedRounds: 0
    },
    
    // WebSocket状态
    socketConnected: false,
    
    // 页面状态
    loading: false,
    refreshing: false,
    
    // 最近活动
    recentActivities: [],
    
    // Cookie状态
    cookieStatus: {
      hasCookie: false,
      isExpired: true,
      daysUntilExpire: 0
    }
  },

  onLoad(options) {
    console.log('监控面板页面加载', options);
    
    // 获取系统信息
    this.getSystemInfo();
    
    // 检查登录状态
    this.checkLoginStatus();
  },

  onShow() {
    // 页面显示时刷新数据
    if (this.data.isLogin) {
      this.loadPageData();
    }
    
    // 监听Socket事件
    this.bindSocketEvents();
    
    // 更新Socket状态
    this.updateSocketStatus();
  },

  onHide() {
    // 取消Socket事件监听
    this.unbindSocketEvents();
  },

  onPullDownRefresh() {
    this.refreshData();
  },

  onReachBottom() {
    // 加载更多活动记录
    this.loadMoreActivities();
  },

  /**
   * Socket消息处理
   */
  onSocketMessage(event, data) {
    console.log('收到Socket消息:', event, data);
    
    switch (event) {
      case 'newProductsFound':
        this.handleNewProducts(data);
        break;
      case 'lowPriceAlert':
        this.handleLowPriceAlert(data);
        break;
      case 'taskStatusUpdate':
        this.handleTaskStatusUpdate(data);
        break;
      case 'monitorRoundComplete':
        this.handleRoundComplete(data);
        break;
    }
  },

  /**
   * 获取系统信息
   */
  getSystemInfo() {
    try {
      const systemInfo = wx.getSystemInfoSync();
      this.setData({
        statusBarHeight: systemInfo.statusBarHeight || 0,
        navigationBarHeight: (systemInfo.statusBarHeight || 0) + 44
      });
    } catch (error) {
      console.error('获取系统信息失败:', error);
    }
  },

  /**
   * 检查登录状态
   */
  checkLoginStatus() {
    const app = getApp();
    const isLogin = app.checkLogin();
    const userInfo = app.getUserInfo();

    this.setData({
      isLogin,
      userInfo: userInfo || null
    });

    if (isLogin) {
      this.loadPageData();
    } else {
      wx.reLaunch({ url: '/pages/login/login' });
    }
  },

  /**
   * 加载模拟数据（用于演示）
   */
  // 删除演示数据函数

  /**
   * 加载页面数据
   */
  async loadPageData() {
    this.setData({ loading: true });
    
    try {
      await Promise.all([
        this.loadMonitorTasks(),
        this.loadUserStats(),
        this.loadCookieStatus(),
        this.loadRecentActivities()
      ]);
    } catch (error) {
      console.error('加载页面数据失败:', error);
      wx.showToast({
        title: '数据加载失败',
        icon: 'error'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 刷新数据
   */
  async refreshData() {
    this.setData({ refreshing: true });
    
    try {
      await this.loadPageData();
      wx.showToast({
        title: '刷新成功',
        icon: 'success'
      });
    } catch (error) {
      console.error('刷新失败:', error);
      wx.showToast({
        title: '刷新失败',
        icon: 'error'
      });
    } finally {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    }
  },

  /**
   * 加载监控任务
   */
  async loadMonitorTasks() {
    try {
      const response = await api.getMonitorTasks({
        page: 1,
        limit: 10,
        status: 'running'
      });
      
      if (response.success) {
        const tasks = response.data.tasks;
        const activeTaskCount = tasks.filter(task => task.status === 'running').length;
        
        this.setData({
          monitorTasks: tasks,
          activeTaskCount
        });
        
        // 加入活动任务的监控房间
        tasks.forEach(task => {
          if (task.status === 'running') {
            joinMonitor(task.id);
          }
        });
      }
    } catch (error) {
      console.error('加载监控任务失败:', error);
    }
  },

  /**
   * 加载用户统计
   */
  async loadUserStats() {
    try {
      const response = await api.getUserStats();
      
      if (response.success) {
        const stats = response.data;
        
        this.setData({
          totalProductsFound: stats.products?.total || 0,
          totalLowPriceAlerts: stats.products?.lowPriceAlerts || 0,
          todayStats: {
            newProducts: stats.products?.recentWeek || 0,
            lowPriceAlerts: stats.products?.lowPriceAlerts || 0,
            completedRounds: stats.totalTasks || 0
          }
        });
      }
    } catch (error) {
      console.error('加载用户统计失败:', error);
    }
  },

  /**
   * 加载Cookie状态
   */
  async loadCookieStatus() {
    try {
      const response = await api.getCookieStatus();
      
      if (response.success) {
        this.setData({
          cookieStatus: response.data
        });
      }
    } catch (error) {
      console.error('加载Cookie状态失败:', error);
    }
  },

  /**
   * 加载最近活动
   */
  async loadRecentActivities() {
    try {
      // 这里可以从后端获取最近的监控活动
      // 目前使用本地存储的活动记录
      const activities = storage.get('recent_activities', []);
      
      this.setData({
        recentActivities: activities.slice(0, 10)
      });
    } catch (error) {
      console.error('加载最近活动失败:', error);
    }
  },

  /**
   * 加载更多活动记录
   */
  async loadMoreActivities() {
    // 加载更多活动记录的逻辑
    console.log('加载更多活动记录');
  },

  /**
   * 绑定Socket事件
   */
  bindSocketEvents() {
    onSocketEvent('connect', this.onSocketConnect.bind(this));
    onSocketEvent('disconnect', this.onSocketDisconnect.bind(this));
    onSocketEvent('message', this.onSocketMessage.bind(this));
  },

  /**
   * 解绑Socket事件
   */
  unbindSocketEvents() {
    offSocketEvent('connect', this.onSocketConnect);
    offSocketEvent('disconnect', this.onSocketDisconnect);
    offSocketEvent('message', this.onSocketMessage);
  },

  /**
   * Socket连接成功
   */
  onSocketConnect() {
    this.setData({ socketConnected: true });
    console.log('Socket连接成功');
  },

  /**
   * Socket连接断开
   */
  onSocketDisconnect() {
    this.setData({ socketConnected: false });
    console.log('Socket连接断开');
  },

  /**
   * 更新Socket状态
   */
  updateSocketStatus() {
    const status = getSocketStatus();
    this.setData({
      socketConnected: status.connected
    });
  },

  /**
   * 处理新商品发现
   */
  handleNewProducts(data) {
    const { total, products } = data;
    
    // 更新统计数据
    this.setData({
      totalProductsFound: this.data.totalProductsFound + total,
      'todayStats.newProducts': this.data.todayStats.newProducts + total
    });
    
    // 添加到活动记录
    this.addActivity({
      type: 'newProducts',
      title: '发现新商品',
      content: `发现 ${total} 个新商品`,
      time: new Date().toISOString(),
      count: total
    });
  },

  /**
   * 处理低价预警
   */
  handleLowPriceAlert(data) {
    const { total, alertPrice } = data;
    
    // 更新统计数据
    this.setData({
      totalLowPriceAlerts: this.data.totalLowPriceAlerts + total,
      'todayStats.lowPriceAlerts': this.data.todayStats.lowPriceAlerts + total
    });
    
    // 添加到活动记录
    this.addActivity({
      type: 'lowPriceAlert',
      title: '🚨 低价预警',
      content: `${total} 个商品低于 ¥${alertPrice}`,
      time: new Date().toISOString(),
      count: total,
      price: alertPrice
    });
  },

  /**
   * 处理任务状态更新
   */
  handleTaskStatusUpdate(data) {
    // 重新加载任务列表
    this.loadMonitorTasks();
  },

  /**
   * 处理监控轮次完成
   */
  handleRoundComplete(data) {
    const { roundNumber, totalChecked, newProducts, lowPriceAlerts } = data;
    
    // 更新今日统计
    this.setData({
      'todayStats.completedRounds': this.data.todayStats.completedRounds + 1
    });
    
    // 如果有新发现，添加到活动记录
    if (newProducts > 0 || lowPriceAlerts > 0) {
      this.addActivity({
        type: 'roundComplete',
        title: `第${roundNumber}轮监控完成`,
        content: `检查${totalChecked}个商品，新发现${newProducts}个，预警${lowPriceAlerts}个`,
        time: new Date().toISOString(),
        round: roundNumber,
        checked: totalChecked,
        newProducts,
        lowPriceAlerts
      });
    }
  },

  /**
   * 添加活动记录
   */
  addActivity(activity) {
    const activities = [activity, ...this.data.recentActivities];
    
    // 限制数量
    if (activities.length > 20) {
      activities.splice(20);
    }
    
    this.setData({
      recentActivities: activities
    });
    
    // 保存到本地存储
    storage.set('recent_activities', activities);
  },

  /**
   * 创建监控任务
   */
  onCreateTask() {
    // 检查Cookie状态
    if (!this.data.cookieStatus.hasCookie || this.data.cookieStatus.isExpired) {
      wx.showModal({
        title: '需要设置Cookie',
        content: 'Cookie未设置或已过期，请先设置Cookie后再创建监控任务',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: '/pages/login/login?action=cookie'
            });
          }
        }
      });
      return;
    }
    
    wx.navigateTo({
      url: '/pages/monitor/monitor'
    });
  },

  /**
   * 查看任务详情
   */
  onTaskDetail(e) {
    const { taskid } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/task-detail/task-detail?id=${taskid}`
    });
  },

  /**
   * 启动/停止任务
   */
  async onToggleTask(e) {
    const { taskid, status } = e.currentTarget.dataset;
    
    try {
      if (status === 'running') {
        await api.stopMonitorTask(taskid);
        wx.showToast({
          title: '任务已停止',
          icon: 'success'
        });
        leaveMonitor(taskid);
      } else {
        await api.startMonitorTask(taskid);
        wx.showToast({
          title: '任务已启动',
          icon: 'success'
        });
        joinMonitor(taskid);
      }
      
      // 重新加载任务列表
      this.loadMonitorTasks();
    } catch (error) {
      console.error('任务操作失败:', error);
      wx.showToast({
        title: error.message || '操作失败',
        icon: 'error'
      });
    }
  },

  /**
   * 查看所有商品
   */
  onViewAllProducts() {
    wx.switchTab({
      url: '/pages/products/products'
    });
  },

  /**
   * 查看低价预警
   */
  onViewAlerts() {
    wx.switchTab({
      url: '/pages/products/products?filter=alert'
    });
  },

  /**
   * 查看历史记录
   */
  onViewHistory() {
    wx.switchTab({
      url: '/pages/history/history'
    });
  },

  /**
   * 设置Cookie
   */
  onSetCookie() {
    wx.navigateTo({
      url: '/pages/login/login?action=cookie'
    });
  },

  /**
   * 快速操作 - 创建简单任务
   */
  onQuickCreate() {
    wx.showModal({
      title: '快速创建监控',
      editable: true,
      placeholderText: '输入商品关键词',
      success: async (res) => {
        if (res.confirm && res.content) {
          try {
            wx.showLoading({ title: '创建中...' });
            
            const taskData = {
              name: `${res.content} - 监控`,
              keywords: [{
                keyword: res.content,
                enabled: true,
                priority: 1
              }],
              interval: 30,
              monitorPages: 3,
              minPrice: 0,
              maxPrice: 999999,
              enableAlert: false
            };
            
            const response = await api.createMonitorTask(taskData);
            
            if (response.success) {
              wx.showToast({
                title: '创建成功',
                icon: 'success'
              });
              
              // 刷新任务列表
              this.loadMonitorTasks();
            }
          } catch (error) {
            console.error('快速创建失败:', error);
            wx.showToast({
              title: error.message || '创建失败',
              icon: 'error'
            });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  /**
   * 显示统计详情
   */
  onShowStats() {
    const { totalProductsFound, totalLowPriceAlerts, todayStats, activeTaskCount } = this.data;
    
    const content = `
活动任务: ${activeTaskCount} 个
总计发现: ${totalProductsFound} 个商品  
低价预警: ${totalLowPriceAlerts} 个
今日新增: ${todayStats.newProducts} 个
今日预警: ${todayStats.lowPriceAlerts} 个
完成轮次: ${todayStats.completedRounds} 次
    `.trim();
    
    wx.showModal({
      title: '监控统计',
      content,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /**
   * 处理活动项点击
   */
  onActivityTap(e) {
    const { index } = e.currentTarget.dataset;
    const activity = this.data.recentActivities[index];
    
    if (!activity) return;
    
    switch (activity.type) {
      case 'newProducts':
      case 'lowPriceAlert':
        wx.switchTab({
          url: '/pages/products/products'
        });
        break;
      case 'roundComplete':
        // 可以显示详细信息或跳转到对应任务
        break;
    }
  },

  /**
   * 重连WebSocket
   */
  onReconnectSocket() {
    const app = getApp();
    app.initWebSocket();
    
    wx.showToast({
      title: '正在重连...',
      icon: 'loading'
    });
  }
});