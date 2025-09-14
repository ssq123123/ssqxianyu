const storage = require('./storage');

/**
 * WebSocket管理类
 */
class SocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    
    // 事件监听器
    this.listeners = {
      connect: [],
      disconnect: [],
      message: [],
      error: []
    };
    
    // 消息队列（连接断开时暂存消息）
    this.messageQueue = [];
    
    // WebSocket配置
    this.config = {
      url: 'wss://xianyu-api-186693-9-1378808167.sh.run.tcloudbase.com/socket.io',
      protocols: ['websocket'],
      heartbeatInterval: 30000, // 30秒心跳
      timeout: 15000
    };
  }

  /**
   * 初始化WebSocket连接
   * @param {object} options 配置选项
   */
  init(options = {}) {
    // 合并配置
    this.config = { ...this.config, ...options };
    
    // 获取用户token
    const token = storage.getToken();
    if (!token) {
      console.warn('未找到用户token，无法连接WebSocket');
      return false;
    }
    
    // 构建WebSocket URL
    const wsUrl = `${this.config.url}?token=${token}`;
    
    try {
      // 创建WebSocket连接
      this.socket = wx.connectSocket({
        url: wsUrl,
        protocols: this.config.protocols
      });
      
      // 绑定事件监听器
      this.bindEvents();
      
      console.log('WebSocket连接初始化...');
      return true;
    } catch (error) {
      console.error('WebSocket连接初始化失败:', error);
      this.handleError(error);
      return false;
    }
  }

  /**
   * 绑定WebSocket事件
   */
  bindEvents() {
    if (!this.socket) return;

    // 连接打开事件
    this.socket.onOpen(() => {
      console.log('WebSocket连接已建立');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // 发送连接成功的消息队列
      this.processMessageQueue();
      
      // 启动心跳
      this.startHeartbeat();
      
      // 触发连接事件
      this.emit('connect');
    });

    // 消息接收事件
    this.socket.onMessage((res) => {
      try {
        const data = JSON.parse(res.data);
        console.log('收到WebSocket消息:', data);
        
        // 处理不同类型的消息
        this.handleMessage(data);
        
        // 触发消息事件
        this.emit('message', data);
      } catch (error) {
        console.error('解析WebSocket消息失败:', error, res.data);
      }
    });

    // 连接关闭事件
    this.socket.onClose((res) => {
      console.log('WebSocket连接已关闭:', res);
      this.isConnected = false;
      
      // 停止心跳
      this.stopHeartbeat();
      
      // 触发断开连接事件
      this.emit('disconnect', res);
      
      // 尝试重连
      if (res.code !== 1000) { // 非正常关闭
        this.scheduleReconnect();
      }
    });

    // 连接错误事件
    this.socket.onError((error) => {
      console.error('WebSocket连接错误:', error);
      this.isConnected = false;
      
      // 触发错误事件
      this.emit('error', error);
      this.handleError(error);
      
      // 尝试重连
      this.scheduleReconnect();
    });
  }

  /**
   * 处理接收到的消息
   * @param {object} data 消息数据
   */
  handleMessage(data) {
    const { type, event, payload } = data;
    
    switch (type) {
      case 'ping':
        // 回复pong
        this.send({ type: 'pong' });
        break;
        
      case 'pong':
        // 心跳回复，不需要处理
        break;
        
      case 'event':
        // 业务事件
        this.handleBusinessEvent(event, payload);
        break;
        
      case 'notification':
        // 通知消息
        this.handleNotification(payload);
        break;
        
      default:
        console.log('未知消息类型:', type, data);
    }
  }

  /**
   * 处理业务事件
   * @param {string} event 事件名
   * @param {object} payload 事件数据
   */
  handleBusinessEvent(event, payload) {
    switch (event) {
      case 'taskStarted':
        this.handleTaskStarted(payload);
        break;
        
      case 'taskStopped':
        this.handleTaskStopped(payload);
        break;
        
      case 'newProductsFound':
        this.handleNewProducts(payload);
        break;
        
      case 'lowPriceAlert':
        this.handleLowPriceAlert(payload);
        break;
        
      case 'monitorRoundComplete':
        this.handleRoundComplete(payload);
        break;
        
      case 'taskError':
        this.handleTaskError(payload);
        break;
        
      default:
        console.log('未知业务事件:', event, payload);
    }
  }

  /**
   * 处理任务启动事件
   * @param {object} payload 
   */
  handleTaskStarted(payload) {
    console.log('监控任务已启动:', payload.taskId);
    
    // 可以在这里更新本地状态
    wx.showToast({
      title: '监控任务已启动',
      icon: 'success'
    });
  }

  /**
   * 处理任务停止事件
   * @param {object} payload 
   */
  handleTaskStopped(payload) {
    console.log('监控任务已停止:', payload.taskId);
    
    wx.showToast({
      title: '监控任务已停止',
      icon: 'none'
    });
  }

  /**
   * 处理新商品发现事件
   * @param {object} payload 
   */
  handleNewProducts(payload) {
    const { total, products } = payload;
    
    wx.showToast({
      title: `发现 ${total} 个新商品`,
      icon: 'success'
    });
    
    // 发送本地通知
    this.sendLocalNotification({
      title: '发现新商品',
      content: `监控发现了 ${total} 个新商品`,
      type: 'newProduct'
    });
  }

  /**
   * 处理低价预警事件
   * @param {object} payload 
   */
  handleLowPriceAlert(payload) {
    const { total, alertPrice } = payload;
    
    // 显示更明显的预警
    wx.showModal({
      title: '🚨 低价预警',
      content: `发现 ${total} 个商品价格低于 ¥${alertPrice}`,
      confirmText: '查看',
      cancelText: '忽略',
      success: (res) => {
        if (res.confirm) {
          // 跳转到商品页面，显示预警商品
          wx.switchTab({
            url: '/pages/products/products?filter=alert'
          });
        }
      }
    });
    
    // 发送本地通知
    this.sendLocalNotification({
      title: '低价预警',
      content: `发现 ${total} 个低价商品，快来查看！`,
      type: 'lowPriceAlert'
    });
    
    // 播放提醒声音
    this.playAlertSound();
  }

  /**
   * 处理监控轮次完成事件
   * @param {object} payload 
   */
  handleRoundComplete(payload) {
    const { taskId, roundNumber, totalChecked, newProducts, lowPriceAlerts } = payload;
    
    console.log(`任务 ${taskId} 第 ${roundNumber} 轮监控完成: 检查 ${totalChecked} 个商品`);
    
    // 如果有新发现，显示通知
    if (newProducts > 0 || lowPriceAlerts > 0) {
      const message = `第${roundNumber}轮: 新商品${newProducts}个，低价预警${lowPriceAlerts}个`;
      
      wx.showToast({
        title: message,
        icon: 'none',
        duration: 3000
      });
    }
  }

  /**
   * 处理任务错误事件
   * @param {object} payload 
   */
  handleTaskError(payload) {
    const { taskId, error } = payload;
    
    console.error('监控任务错误:', taskId, error);
    
    wx.showModal({
      title: '监控任务异常',
      content: `任务出现错误: ${error}`,
      showCancel: false,
      confirmText: '知道了'
    });
  }

  /**
   * 处理通知消息
   * @param {object} payload 
   */
  handleNotification(payload) {
    const { title, content, type, action } = payload;
    
    // 显示系统通知
    wx.showModal({
      title: title || '系统通知',
      content: content || '您有新的消息',
      confirmText: '查看',
      cancelText: '忽略',
      success: (res) => {
        if (res.confirm && action) {
          // 执行相应的动作
          this.handleNotificationAction(action);
        }
      }
    });
  }

  /**
   * 处理通知动作
   * @param {object} action 
   */
  handleNotificationAction(action) {
    const { type, url, data } = action;
    
    switch (type) {
      case 'navigate':
        if (url) {
          wx.navigateTo({ url });
        }
        break;
        
      case 'switchTab':
        if (url) {
          wx.switchTab({ url });
        }
        break;
        
      case 'reLaunch':
        if (url) {
          wx.reLaunch({ url });
        }
        break;
        
      default:
        console.log('未知通知动作:', type);
    }
  }

  /**
   * 发送本地通知
   * @param {object} notification 
   */
  sendLocalNotification(notification) {
    // 检查用户设置是否允许通知
    const appSettings = storage.getAppSettings();
    const notificationSettings = appSettings.notifications;
    
    if (!notificationSettings[notification.type]) {
      return; // 用户已关闭此类通知
    }
    
    // 这里可以集成微信的消息推送或其他通知方式
    console.log('发送本地通知:', notification);
  }

  /**
   * 播放提醒声音
   */
  playAlertSound() {
    const appSettings = storage.getAppSettings();
    
    if (appSettings.sounds.enabled && appSettings.sounds.lowPriceAlert) {
      // 播放系统提示音
      wx.showToast({
        title: '🔔',
        icon: 'none',
        duration: 500
      });
    }
  }

  /**
   * 发送消息
   * @param {object} data 消息数据
   */
  send(data) {
    if (!this.socket) {
      console.warn('WebSocket未初始化');
      return false;
    }
    
    if (!this.isConnected) {
      // 连接断开，将消息加入队列
      this.messageQueue.push(data);
      console.log('WebSocket未连接，消息已加入队列');
      return false;
    }
    
    try {
      const message = JSON.stringify(data);
      this.socket.send({ data: message });
      console.log('发送WebSocket消息:', data);
      return true;
    } catch (error) {
      console.error('发送WebSocket消息失败:', error);
      return false;
    }
  }

  /**
   * 处理消息队列
   */
  processMessageQueue() {
    if (this.messageQueue.length === 0) return;
    
    console.log(`处理消息队列，共 ${this.messageQueue.length} 条消息`);
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
    
    console.log('心跳已启动');
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('心跳已停止');
    }
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('达到最大重连次数，停止重连');
      return;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts); // 指数退避
    console.log(`${delay}ms 后尝试第 ${this.reconnectAttempts + 1} 次重连`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  /**
   * 重连
   */
  reconnect() {
    if (this.isConnected) return;
    
    this.reconnectAttempts++;
    console.log(`开始第 ${this.reconnectAttempts} 次重连...`);
    
    // 关闭旧连接
    this.disconnect();
    
    // 尝试重新连接
    this.init();
  }

  /**
   * 断开连接
   */
  disconnect() {
    console.log('主动断开WebSocket连接');
    
    this.isConnected = false;
    
    // 停止心跳
    this.stopHeartbeat();
    
    // 取消重连
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // 关闭WebSocket连接
    if (this.socket) {
      try {
        this.socket.close({
          code: 1000,
          reason: '主动断开连接'
        });
      } catch (error) {
        console.warn('关闭WebSocket连接时出错:', error);
      }
      this.socket = null;
    }
    
    // 清空消息队列
    this.messageQueue = [];
    
    // 触发断开连接事件
    this.emit('disconnect', { code: 1000, reason: '主动断开' });
  }

  /**
   * 处理错误
   * @param {object} error 
   */
  handleError(error) {
    console.error('WebSocket错误:', error);
    
    // 可以在这里添加错误上报逻辑
    // 比如发送到监控系统
  }

  /**
   * 添加事件监听器
   * @param {string} event 事件名
   * @param {Function} listener 监听函数
   */
  on(event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  /**
   * 移除事件监听器
   * @param {string} event 事件名
   * @param {Function} listener 监听函数
   */
  off(event, listener) {
    if (!this.listeners[event]) return;
    
    const index = this.listeners[event].indexOf(listener);
    if (index > -1) {
      this.listeners[event].splice(index, 1);
    }
  }

  /**
   * 触发事件
   * @param {string} event 事件名
   * @param {any} data 事件数据
   */
  emit(event, data) {
    if (!this.listeners[event]) return;
    
    this.listeners[event].forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error('事件监听器执行失败:', error);
      }
    });
  }

  /**
   * 获取连接状态
   * @returns {boolean}
   */
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length
    };
  }

  /**
   * 加入监控房间
   * @param {string} taskId 任务ID
   */
  joinMonitorRoom(taskId) {
    if (!taskId) return;
    
    this.send({
      type: 'event',
      event: 'joinMonitor',
      payload: { taskId }
    });
  }

  /**
   * 离开监控房间
   * @param {string} taskId 任务ID
   */
  leaveMonitorRoom(taskId) {
    if (!taskId) return;
    
    this.send({
      type: 'event',
      event: 'leaveMonitor',
      payload: { taskId }
    });
  }
}

// 创建全局实例
const socketManager = new SocketManager();

// 导出便捷方法
module.exports = {
  // 初始化WebSocket连接
  initSocket: (options) => {
    return socketManager.init(options);
  },
  
  // 关闭WebSocket连接
  closeSocket: () => {
    socketManager.disconnect();
  },
  
  // 发送消息
  sendMessage: (data) => {
    return socketManager.send(data);
  },
  
  // 添加事件监听
  onSocketEvent: (event, listener) => {
    socketManager.on(event, listener);
  },
  
  // 移除事件监听
  offSocketEvent: (event, listener) => {
    socketManager.off(event, listener);
  },
  
  // 获取连接状态
  getSocketStatus: () => {
    return socketManager.getConnectionStatus();
  },
  
  // 加入监控房间
  joinMonitor: (taskId) => {
    socketManager.joinMonitorRoom(taskId);
  },
  
  // 离开监控房间
  leaveMonitor: (taskId) => {
    socketManager.leaveMonitorRoom(taskId);
  },
  
  // 获取管理器实例（用于高级操作）
  getManager: () => {
    return socketManager;
  }
};
