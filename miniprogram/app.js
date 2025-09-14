const api = require('./utils/api');
const storage = require('./utils/storage');
const { initSocket, closeSocket } = require('./utils/socket');

App({
  globalData: {
    // 用户信息
    userInfo: null,
    token: null,
    
    // 系统信息
    systemInfo: null,
    statusBarHeight: 0,
    navigationBarHeight: 0,
    
    // 应用状态
    isLogin: false,
    networkStatus: 'wifi',
    
    // 监控状态
    monitorTasks: [],
    activeTaskCount: 0,
    
    // WebSocket连接状态
    socketConnected: false,
    
    // 配置信息
    config: {
      baseUrl: 'https://your-domain.com',
      version: '1.0.0',
      updateTime: new Date().toISOString()
    }
  },

  onLaunch(options) {
    console.log('小程序启动', options);
    
    // 初始化应用
    this.initApp();
    
    // 检查更新
    this.checkForUpdate();
  },

  onShow(options) {
    console.log('小程序显示', options);
    
    // 更新网络状态
    this.checkNetworkStatus();
    
    // 如果已登录，刷新用户状态
    if (this.globalData.isLogin) {
      this.refreshUserStatus();
    }
  },

  onHide() {
    console.log('小程序隐藏');
    
    // 断开WebSocket连接
    closeSocket();
    this.globalData.socketConnected = false;
  },

  onError(error) {
    console.error('小程序错误:', error);
    
    // 记录错误日志
    this.logError(error);
  },

  /**
   * 初始化应用
   */
  async initApp() {
    try {
      // 获取系统信息
      const systemInfo = await this.getSystemInfo();
      this.globalData.systemInfo = systemInfo;
      
      // 计算状态栏和导航栏高度
      this.calculateBarHeight(systemInfo);
      
      // 加载本地存储的用户信息
      this.loadUserInfo();
      
      console.log('应用初始化完成');
    } catch (error) {
      console.error('应用初始化失败:', error);
    }
  },

  /**
   * 获取系统信息
   */
  getSystemInfo() {
    return new Promise((resolve) => {
      wx.getSystemInfo({
        success: resolve,
        fail: () => resolve({})
      });
    });
  },

  /**
   * 计算状态栏和导航栏高度
   */
  calculateBarHeight(systemInfo) {
    const { statusBarHeight = 0, platform } = systemInfo;
    this.globalData.statusBarHeight = statusBarHeight;
    
    // 不同平台导航栏高度不同
    let navigationBarHeight = 44; // 默认高度
    if (platform === 'android') {
      navigationBarHeight = 48;
    } else if (platform === 'ios') {
      navigationBarHeight = 44;
    }
    
    this.globalData.navigationBarHeight = statusBarHeight + navigationBarHeight;
  },

  /**
   * 加载用户信息
   */
  loadUserInfo() {
    try {
      const token = storage.getToken();
      const userInfo = storage.getUserInfo();
      
      if (token && userInfo) {
        this.globalData.token = token;
        this.globalData.userInfo = userInfo;
        this.globalData.isLogin = true;
        
        // 设置API默认token
        api.setToken(token);
        
        console.log('用户信息加载成功');
      }
    } catch (error) {
      console.error('加载用户信息失败:', error);
    }
  },

  /**
   * 用户登录
   */
  async login(userInfo) {
    try {
      // 获取微信登录码
      const { code } = await this.getWxCode();
      
      // 调用后端登录接口
      const response = await api.login({ code, userInfo });
      
      if (response.success) {
        const { token, refreshToken, user } = response.data;
        
        // 保存用户信息
        this.globalData.token = token;
        this.globalData.userInfo = user;
        this.globalData.isLogin = true;
        
        // 存储到本地
        storage.setToken(token);
        storage.setRefreshToken(refreshToken);
        storage.setUserInfo(user);
        
        // 设置API默认token
        api.setToken(token);
        
        // 初始化WebSocket连接
        this.initWebSocket();
        
        console.log('登录成功:', user);
        return { success: true, user };
      } else {
        throw new Error(response.message);
      }
    } catch (error) {
      console.error('登录失败:', error);
      this.showToast('登录失败: ' + error.message, 'error');
      return { success: false, error };
    }
  },

  /**
   * 获取微信登录码
   */
  getWxCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: resolve,
        fail: reject
      });
    });
  },

  /**
   * 用户退出登录
   */
  async logout() {
    try {
      // 调用后端退出接口
      await api.logout();
    } catch (error) {
      console.warn('调用退出接口失败:', error);
    } finally {
      // 清理本地数据
      this.clearUserData();
      
      // 断开WebSocket连接
      closeSocket();
      this.globalData.socketConnected = false;
      
      this.showToast('退出登录成功');
      
      // 跳转到登录页
      wx.reLaunch({
        url: '/pages/login/login'
      });
    }
  },

  /**
   * 清理用户数据
   */
  clearUserData() {
    this.globalData.token = null;
    this.globalData.userInfo = null;
    this.globalData.isLogin = false;
    this.globalData.monitorTasks = [];
    this.globalData.activeTaskCount = 0;
    
    storage.clear();
    api.clearToken();
  },

  /**
   * 刷新用户状态
   */
  async refreshUserStatus() {
    try {
      const response = await api.getUserProfile();
      if (response.success) {
        this.globalData.userInfo = response.data;
        storage.setUserInfo(response.data);
      }
    } catch (error) {
      console.warn('刷新用户状态失败:', error);
      
      // 如果是token过期，跳转到登录页
      if (error.code === 'TOKEN_EXPIRED') {
        this.clearUserData();
        wx.reLaunch({
          url: '/pages/login/login'
        });
      }
    }
  },

  /**
   * 初始化WebSocket连接
   */
  initWebSocket() {
    if (!this.globalData.isLogin) return;
    
    try {
      initSocket({
        onConnect: () => {
          this.globalData.socketConnected = true;
          console.log('WebSocket连接成功');
        },
        onDisconnect: () => {
          this.globalData.socketConnected = false;
          console.log('WebSocket连接断开');
        },
        onMessage: (data) => {
          this.handleSocketMessage(data);
        }
      });
    } catch (error) {
      console.error('WebSocket初始化失败:', error);
    }
  },

  /**
   * 处理WebSocket消息
   */
  handleSocketMessage(data) {
    const { event, payload } = data;
    
    switch (event) {
      case 'newProductsFound':
        this.handleNewProducts(payload);
        break;
      case 'lowPriceAlert':
        this.handleLowPriceAlert(payload);
        break;
      case 'taskStatusUpdate':
        this.handleTaskStatusUpdate(payload);
        break;
      case 'monitorLog':
        this.handleMonitorLog(payload);
        break;
      default:
        console.log('未处理的Socket消息:', event, payload);
    }
  },

  /**
   * 处理新商品发现
   */
  handleNewProducts(payload) {
    const { products, total } = payload;
    
    // 显示通知
    this.showToast(`发现 ${total} 个新商品`, 'success');
    
    // 触发页面更新事件
    this.triggerPageEvent('newProductsFound', payload);
  },

  /**
   * 处理低价预警
   */
  handleLowPriceAlert(payload) {
    const { products, total, alertPrice } = payload;
    
    // 显示预警通知
    this.showToast(`🚨 ${total} 个低价预警商品!`, 'error');
    
    // 可以考虑显示更明显的预警
    wx.showModal({
      title: '低价预警',
      content: `发现 ${total} 个商品价格低于 ¥${alertPrice}，点击查看详情`,
      confirmText: '查看',
      success: (res) => {
        if (res.confirm) {
          wx.switchTab({
            url: '/pages/products/products?filter=alert'
          });
        }
      }
    });
    
    // 触发页面更新事件
    this.triggerPageEvent('lowPriceAlert', payload);
  },

  /**
   * 处理任务状态更新
   */
  handleTaskStatusUpdate(payload) {
    // 触发页面更新事件
    this.triggerPageEvent('taskStatusUpdate', payload);
  },

  /**
   * 处理监控日志
   */
  handleMonitorLog(payload) {
    // 触发页面更新事件
    this.triggerPageEvent('monitorLog', payload);
  },

  /**
   * 触发页面事件
   */
  triggerPageEvent(event, data) {
    // 获取当前页面实例
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    
    if (currentPage && typeof currentPage.onSocketMessage === 'function') {
      currentPage.onSocketMessage(event, data);
    }
  },

  /**
   * 检查网络状态
   */
  checkNetworkStatus() {
    wx.getNetworkType({
      success: (res) => {
        this.globalData.networkStatus = res.networkType;
        
        if (res.networkType === 'none') {
          this.showToast('网络连接异常，请检查网络设置', 'error');
        }
      }
    });
  },

  /**
   * 检查小程序更新
   */
  checkForUpdate() {
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();
      
      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          console.log('发现新版本');
        }
      });
      
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已准备好，是否重启应用？',
          success: (res) => {
            if (res.confirm) {
              updateManager.applyUpdate();
            }
          }
        });
      });
      
      updateManager.onUpdateFailed(() => {
        console.error('新版本下载失败');
      });
    }
  },

  /**
   * 显示Toast消息
   */
  showToast(message, type = 'info', duration = 2000) {
    try {
      wx.showToast({
        title: message,
        icon: type === 'success' ? 'success' : type === 'loading' ? 'loading' : 'none',
        duration
      });
    } catch (error) {
      console.error('显示Toast失败:', error);
    }
  },

  /**
   * 记录错误日志
   */
  logError(error) {
    try {
      // 可以发送到服务器记录
      console.error('应用错误:', error);
      
      // 本地存储错误信息用于调试
      const errorInfo = {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        userInfo: this.globalData.userInfo,
        systemInfo: this.globalData.systemInfo
      };
      
      const errors = storage.get('app_errors') || [];
      errors.push(errorInfo);
      
      // 只保留最近50条错误
      if (errors.length > 50) {
        errors.splice(0, errors.length - 50);
      }
      
      storage.set('app_errors', errors);
    } catch (e) {
      console.error('记录错误失败:', e);
    }
  },

  /**
   * 获取用户信息
   */
  getUserInfo() {
    return this.globalData.userInfo;
  },

  /**
   * 检查是否已登录
   */
  checkLogin() {
    return this.globalData.isLogin;
  },

  /**
   * 更新监控任务状态
   */
  updateMonitorTasks(tasks) {
    this.globalData.monitorTasks = tasks;
    this.globalData.activeTaskCount = tasks.filter(task => task.status === 'running').length;
  }
});
