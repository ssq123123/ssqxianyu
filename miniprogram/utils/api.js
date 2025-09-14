const storage = require('./storage');

// API基础配置
const CONFIG = {
  baseUrl: 'https://xianyu-api-186693-9-1378808167.sh.run.tcloudbase.com/api',
  timeout: 30000,
  retries: 3,
  retryDelay: 1000
};

// 请求拦截器
const requestInterceptors = [];
const responseInterceptors = [];

/**
 * API工具类
 */
class ApiService {
  constructor() {
    this.baseUrl = CONFIG.baseUrl;
    this.token = storage.getToken();
    this.requestQueue = new Map();
  }

  /**
   * 设置基础URL
   * @param {string} baseUrl 
   */
  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * 设置认证token
   * @param {string} token 
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * 清除认证token
   */
  clearToken() {
    this.token = null;
  }

  /**
   * 构建完整URL
   * @param {string} url 
   * @returns {string}
   */
  buildUrl(url) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.baseUrl}${url.startsWith('/') ? url : '/' + url}`;
  }

  /**
   * 构建请求头
   * @param {object} headers 
   * @returns {object}
   */
  buildHeaders(headers = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };

    if (this.token) {
      defaultHeaders.Authorization = `Bearer ${this.token}`;
    }

    return { ...defaultHeaders, ...headers };
  }

  /**
   * 处理请求拦截器
   * @param {object} config 
   * @returns {object}
   */
  async applyRequestInterceptors(config) {
    let modifiedConfig = config;
    
    for (const interceptor of requestInterceptors) {
      try {
        modifiedConfig = await interceptor(modifiedConfig);
      } catch (error) {
        console.warn('请求拦截器执行失败:', error);
      }
    }
    
    return modifiedConfig;
  }

  /**
   * 处理响应拦截器
   * @param {object} response 
   * @returns {object}
   */
  async applyResponseInterceptors(response) {
    let modifiedResponse = response;
    
    for (const interceptor of responseInterceptors) {
      try {
        modifiedResponse = await interceptor(modifiedResponse);
      } catch (error) {
        console.warn('响应拦截器执行失败:', error);
      }
    }
    
    return modifiedResponse;
  }

  /**
   * 发送HTTP请求
   * @param {object} options 
   * @returns {Promise}
   */
  async request(options) {
    const {
      url,
      method = 'GET',
      data = {},
      params = {},
      headers = {},
      timeout = CONFIG.timeout,
      retries = CONFIG.retries,
      skipAuth = false,
      showLoading = true,
      loadingText = '请求中...'
    } = options;

    // 构建请求配置
    let config = {
      url: this.buildUrl(url),
      method: method.toUpperCase(),
      data: method.toUpperCase() === 'GET' ? params : data,
      header: this.buildHeaders(headers),
      timeout,
      skipAuth,
      retries,
      showLoading,
      loadingText
    };

    // 应用请求拦截器
    config = await this.applyRequestInterceptors(config);

    // 防止重复请求
    const requestKey = this.generateRequestKey(config);
    if (this.requestQueue.has(requestKey)) {
      return this.requestQueue.get(requestKey);
    }

    // 显示loading
    if (showLoading) {
      wx.showLoading({
        title: loadingText,
        mask: true
      });
    }

    // 创建请求Promise
    const requestPromise = this.executeRequest(config);
    
    // 添加到请求队列
    this.requestQueue.set(requestKey, requestPromise);

    try {
      const response = await requestPromise;
      
      // 应用响应拦截器
      const processedResponse = await this.applyResponseInterceptors(response);
      
      return processedResponse;
    } catch (error) {
      throw error;
    } finally {
      // 移除请求队列
      this.requestQueue.delete(requestKey);
      
      // 隐藏loading
      if (showLoading) {
        wx.hideLoading();
      }
    }
  }

  /**
   * 执行HTTP请求（包含重试逻辑）
   * @param {object} config 
   * @returns {Promise}
   */
  async executeRequest(config, retryCount = 0) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: config.url,
        method: config.method,
        data: config.data,
        header: config.header,
        timeout: config.timeout,
        success: (res) => {
          console.log(`API请求成功: ${config.method} ${config.url}`, res);
          
          const { statusCode, data } = res;
          
          // HTTP状态码检查
          if (statusCode >= 200 && statusCode < 300) {
            resolve({
              success: true,
              data,
              statusCode,
              headers: res.header
            });
          } else if (statusCode === 401) {
            // token过期处理
            this.handleTokenExpired();
            reject({
              success: false,
              message: '登录已过期，请重新登录',
              code: 'TOKEN_EXPIRED',
              statusCode
            });
          } else if (statusCode >= 400) {
            // 业务错误
            reject({
              success: false,
              message: data?.message || `请求失败 (${statusCode})`,
              code: data?.code || 'REQUEST_ERROR',
              statusCode,
              data
            });
          } else {
            reject({
              success: false,
              message: '请求失败',
              statusCode
            });
          }
        },
        fail: (error) => {
          console.error(`API请求失败: ${config.method} ${config.url}`, error);
          
          // 重试逻辑
          if (retryCount < config.retries && this.shouldRetry(error)) {
            console.log(`请求重试 ${retryCount + 1}/${config.retries}: ${config.url}`);
            
            setTimeout(() => {
              this.executeRequest(config, retryCount + 1)
                .then(resolve)
                .catch(reject);
            }, CONFIG.retryDelay * (retryCount + 1));
          } else {
            reject({
              success: false,
              message: this.getErrorMessage(error),
              code: 'NETWORK_ERROR',
              error
            });
          }
        }
      });
    });
  }

  /**
   * 判断是否应该重试
   * @param {object} error 
   * @returns {boolean}
   */
  shouldRetry(error) {
    const retryableErrors = [
      'timeout',
      'fail',
      'request:fail',
      'network error'
    ];
    
    return retryableErrors.some(errorType => 
      error.errMsg && error.errMsg.includes(errorType)
    );
  }

  /**
   * 获取错误消息
   * @param {object} error 
   * @returns {string}
   */
  getErrorMessage(error) {
    if (error.errMsg) {
      if (error.errMsg.includes('timeout')) {
        return '请求超时，请检查网络连接';
      }
      if (error.errMsg.includes('fail')) {
        return '网络连接失败，请检查网络设置';
      }
    }
    return error.message || '网络异常，请稍后重试';
  }

  /**
   * 处理token过期
   */
  handleTokenExpired() {
    this.clearToken();
    storage.clear();
    
    // 跳转到登录页
    wx.reLaunch({
      url: '/pages/login/login'
    });
    
    wx.showToast({
      title: '登录已过期，请重新登录',
      icon: 'none',
      duration: 2000
    });
  }

  /**
   * 生成请求唯一标识
   * @param {object} config 
   * @returns {string}
   */
  generateRequestKey(config) {
    return `${config.method}_${config.url}_${JSON.stringify(config.data)}`;
  }

  /**
   * GET请求
   * @param {string} url 
   * @param {object} params 
   * @param {object} options 
   * @returns {Promise}
   */
  get(url, params = {}, options = {}) {
    return this.request({
      url,
      method: 'GET',
      params,
      ...options
    });
  }

  /**
   * POST请求
   * @param {string} url 
   * @param {object} data 
   * @param {object} options 
   * @returns {Promise}
   */
  post(url, data = {}, options = {}) {
    return this.request({
      url,
      method: 'POST',
      data,
      ...options
    });
  }

  /**
   * PUT请求
   * @param {string} url 
   * @param {object} data 
   * @param {object} options 
   * @returns {Promise}
   */
  put(url, data = {}, options = {}) {
    return this.request({
      url,
      method: 'PUT',
      data,
      ...options
    });
  }

  /**
   * DELETE请求
   * @param {string} url 
   * @param {object} options 
   * @returns {Promise}
   */
  delete(url, options = {}) {
    return this.request({
      url,
      method: 'DELETE',
      ...options
    });
  }

  // ==================== 具体API方法 ====================

  /**
   * 用户登录
   * @param {object} params 
   * @returns {Promise}
   */
  async login(params) {
    return this.post('/auth/login', params, {
      skipAuth: true,
      showLoading: true,
      loadingText: '登录中...',
      retries: 0,
      timeout: 20000
    });
  }

  /**
   * 刷新token
   * @param {string} refreshToken 
   * @returns {Promise}
   */
  async refreshToken(refreshToken) {
    return this.post('/auth/refresh', { refreshToken }, {
      skipAuth: true
    });
  }

  /**
   * 退出登录
   * @returns {Promise}
   */
  async logout() {
    return this.post('/auth/logout');
  }

  /**
   * 获取用户信息
   * @returns {Promise}
   */
  async getUserProfile() {
    return this.get('/auth/profile');
  }

  /**
   * 更新用户信息
   * @param {object} userInfo 
   * @returns {Promise}
   */
  async updateUserProfile(userInfo) {
    return this.put('/auth/profile', userInfo);
  }

  /**
   * 更新Cookie
   * @param {string} cookie 
   * @returns {Promise}
   */
  async updateCookie(cookie) {
    return this.post('/auth/cookie', { cookie }, {
      showLoading: true,
      loadingText: '保存中...'
    });
  }

  /**
   * 获取Cookie状态
   * @returns {Promise}
   */
  async getCookieStatus() {
    return this.get('/auth/cookie/status');
  }

  /**
   * 获取用户统计
   * @returns {Promise}
   */
  async getUserStats() {
    return this.get('/auth/stats');
  }

  /**
   * 创建监控任务
   * @param {object} taskData 
   * @returns {Promise}
   */
  async createMonitorTask(taskData) {
    return this.post('/monitor/tasks', taskData, {
      showLoading: true,
      loadingText: '创建中...'
    });
  }

  /**
   * 获取监控任务列表
   * @param {object} params 
   * @returns {Promise}
   */
  async getMonitorTasks(params = {}) {
    return this.get('/monitor/tasks', params);
  }

  /**
   * 获取监控任务详情
   * @param {string} taskId 
   * @returns {Promise}
   */
  async getMonitorTask(taskId) {
    return this.get(`/monitor/tasks/${taskId}`);
  }

  /**
   * 更新监控任务
   * @param {string} taskId 
   * @param {object} taskData 
   * @returns {Promise}
   */
  async updateMonitorTask(taskId, taskData) {
    return this.put(`/monitor/tasks/${taskId}`, taskData, {
      showLoading: true,
      loadingText: '更新中...'
    });
  }

  /**
   * 启动监控任务
   * @param {string} taskId 
   * @returns {Promise}
   */
  async startMonitorTask(taskId) {
    return this.post(`/monitor/tasks/${taskId}/start`, {}, {
      showLoading: true,
      loadingText: '启动中...'
    });
  }

  /**
   * 停止监控任务
   * @param {string} taskId 
   * @returns {Promise}
   */
  async stopMonitorTask(taskId) {
    return this.post(`/monitor/tasks/${taskId}/stop`, {}, {
      showLoading: true,
      loadingText: '停止中...'
    });
  }

  /**
   * 暂停/恢复监控任务
   * @param {string} taskId 
   * @returns {Promise}
   */
  async pauseMonitorTask(taskId) {
    return this.post(`/monitor/tasks/${taskId}/pause`);
  }

  /**
   * 删除监控任务
   * @param {string} taskId 
   * @returns {Promise}
   */
  async deleteMonitorTask(taskId) {
    return this.delete(`/monitor/tasks/${taskId}`, {
      showLoading: true,
      loadingText: '删除中...'
    });
  }

  /**
   * 获取任务运行状态
   * @param {string} taskId 
   * @returns {Promise}
   */
  async getTaskStatus(taskId) {
    return this.get(`/monitor/tasks/${taskId}/status`);
  }

  /**
   * 获取所有监控状态
   * @returns {Promise}
   */
  async getMonitorStatus() {
    return this.get('/monitor/status');
  }

  /**
   * 获取商品列表
   * @param {object} params 
   * @returns {Promise}
   */
  async getProducts(params = {}) {
    return this.get('/products', params);
  }

  /**
   * 获取商品详情
   * @param {string} productId 
   * @returns {Promise}
   */
  async getProduct(productId) {
    return this.get(`/products/${productId}`);
  }

  /**
   * 记录商品操作
   * @param {string} productId 
   * @param {string} action 
   * @returns {Promise}
   */
  async recordProductAction(productId, action) {
    return this.post(`/products/${productId}/action`, { action });
  }

  /**
   * 获取商品统计
   * @param {string} taskId 
   * @returns {Promise}
   */
  async getProductStats(taskId) {
    const url = taskId ? `/products/stats/${taskId}` : '/products/stats';
    return this.get(url);
  }

  /**
   * 导出商品数据
   * @param {object} params 
   * @returns {Promise}
   */
  async exportProducts(params) {
    return this.post('/products/export', params, {
      showLoading: true,
      loadingText: '导出中...',
      timeout: 60000 // 导出可能需要更长时间
    });
  }

  /**
   * 获取热门关键词
   * @param {object} params 
   * @returns {Promise}
   */
  async getPopularKeywords(params = {}) {
    return this.get('/products/keywords/popular', params);
  }

  /**
   * 删除商品
   * @param {string} productId 
   * @returns {Promise}
   */
  async deleteProduct(productId) {
    return this.delete(`/products/${productId}`);
  }

  /**
   * 批量删除商品
   * @param {Array} productIds 
   * @returns {Promise}
   */
  async batchDeleteProducts(productIds) {
    return this.post('/products/batch-delete', { productIds }, {
      showLoading: true,
      loadingText: '删除中...'
    });
  }
}

// 创建API实例
const api = new ApiService();

/**
 * 添加请求拦截器
 * @param {Function} interceptor 
 */
function addRequestInterceptor(interceptor) {
  requestInterceptors.push(interceptor);
}

/**
 * 添加响应拦截器
 * @param {Function} interceptor 
 */
function addResponseInterceptor(interceptor) {
  responseInterceptors.push(interceptor);
}

// 默认响应拦截器 - 处理通用错误
addResponseInterceptor((response) => {
  if (response.data && !response.data.success) {
    // 显示错误消息
    wx.showToast({
      title: response.data.message || '操作失败',
      icon: 'none',
      duration: 2000
    });
  }
  
  // 返回业务数据
  return response.data || response;
});

module.exports = api;
