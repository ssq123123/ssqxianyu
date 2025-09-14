/**
 * 本地存储工具类
 */

const STORAGE_KEYS = {
  TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_INFO: 'user_info',
  COOKIE_STATUS: 'cookie_status',
  MONITOR_SETTINGS: 'monitor_settings',
  SEARCH_HISTORY: 'search_history',
  EXPORT_HISTORY: 'export_history',
  APP_SETTINGS: 'app_settings',
  TASK_CACHE: 'task_cache',
  PRODUCT_CACHE: 'product_cache'
};

class Storage {
  /**
   * 存储数据
   * @param {string} key 
   * @param {any} data 
   * @param {number} expiry 过期时间（毫秒），可选
   */
  set(key, data, expiry) {
    try {
      const item = {
        data,
        timestamp: Date.now(),
        expiry: expiry ? Date.now() + expiry : null
      };
      
      wx.setStorageSync(key, JSON.stringify(item));
      return true;
    } catch (error) {
      console.error('存储数据失败:', key, error);
      return false;
    }
  }

  /**
   * 获取数据
   * @param {string} key 
   * @param {any} defaultValue 默认值
   * @returns {any}
   */
  get(key, defaultValue = null) {
    try {
      const itemStr = wx.getStorageSync(key);
      if (!itemStr) return defaultValue;
      
      const item = JSON.parse(itemStr);
      
      // 检查是否过期
      if (item.expiry && Date.now() > item.expiry) {
        this.remove(key);
        return defaultValue;
      }
      
      return item.data;
    } catch (error) {
      console.error('获取数据失败:', key, error);
      return defaultValue;
    }
  }

  /**
   * 删除数据
   * @param {string} key 
   */
  remove(key) {
    try {
      wx.removeStorageSync(key);
      return true;
    } catch (error) {
      console.error('删除数据失败:', key, error);
      return false;
    }
  }

  /**
   * 清除所有数据
   */
  clear() {
    try {
      wx.clearStorageSync();
      return true;
    } catch (error) {
      console.error('清除数据失败:', error);
      return false;
    }
  }

  /**
   * 获取存储信息
   * @returns {object}
   */
  getInfo() {
    try {
      return wx.getStorageInfoSync();
    } catch (error) {
      console.error('获取存储信息失败:', error);
      return {
        keys: [],
        currentSize: 0,
        limitSize: 0
      };
    }
  }

  /**
   * 检查key是否存在
   * @param {string} key 
   * @returns {boolean}
   */
  has(key) {
    try {
      const info = this.getInfo();
      return info.keys.includes(key);
    } catch (error) {
      return false;
    }
  }

  // ================ 用户相关存储 ================

  /**
   * 存储访问令牌
   * @param {string} token 
   */
  setToken(token) {
    return this.set(STORAGE_KEYS.TOKEN, token);
  }

  /**
   * 获取访问令牌
   * @returns {string|null}
   */
  getToken() {
    return this.get(STORAGE_KEYS.TOKEN);
  }

  /**
   * 存储刷新令牌
   * @param {string} refreshToken 
   */
  setRefreshToken(refreshToken) {
    // 刷新令牌设置90天过期
    return this.set(STORAGE_KEYS.REFRESH_TOKEN, refreshToken, 90 * 24 * 60 * 60 * 1000);
  }

  /**
   * 获取刷新令牌
   * @returns {string|null}
   */
  getRefreshToken() {
    return this.get(STORAGE_KEYS.REFRESH_TOKEN);
  }

  /**
   * 存储用户信息
   * @param {object} userInfo 
   */
  setUserInfo(userInfo) {
    return this.set(STORAGE_KEYS.USER_INFO, userInfo);
  }

  /**
   * 获取用户信息
   * @returns {object|null}
   */
  getUserInfo() {
    return this.get(STORAGE_KEYS.USER_INFO);
  }

  /**
   * 存储Cookie状态
   * @param {object} status 
   */
  setCookieStatus(status) {
    return this.set(STORAGE_KEYS.COOKIE_STATUS, status, 24 * 60 * 60 * 1000); // 24小时缓存
  }

  /**
   * 获取Cookie状态
   * @returns {object|null}
   */
  getCookieStatus() {
    return this.get(STORAGE_KEYS.COOKIE_STATUS);
  }

  // ================ 监控相关存储 ================

  /**
   * 存储监控设置
   * @param {object} settings 
   */
  setMonitorSettings(settings) {
    return this.set(STORAGE_KEYS.MONITOR_SETTINGS, settings);
  }

  /**
   * 获取监控设置
   * @returns {object}
   */
  getMonitorSettings() {
    return this.get(STORAGE_KEYS.MONITOR_SETTINGS, {
      defaultInterval: 30,
      defaultPages: 3,
      enableAlert: false,
      alertPrice: 100,
      soundAlert: true,
      multiImages: true
    });
  }

  /**
   * 存储任务缓存
   * @param {string} taskId 
   * @param {object} taskData 
   */
  setTaskCache(taskId, taskData) {
    const cache = this.get(STORAGE_KEYS.TASK_CACHE, {});
    cache[taskId] = {
      ...taskData,
      cacheTime: Date.now()
    };
    return this.set(STORAGE_KEYS.TASK_CACHE, cache, 30 * 60 * 1000); // 30分钟缓存
  }

  /**
   * 获取任务缓存
   * @param {string} taskId 
   * @returns {object|null}
   */
  getTaskCache(taskId) {
    const cache = this.get(STORAGE_KEYS.TASK_CACHE, {});
    return cache[taskId] || null;
  }

  /**
   * 清除任务缓存
   * @param {string} taskId 可选，不传则清除所有
   */
  clearTaskCache(taskId) {
    if (taskId) {
      const cache = this.get(STORAGE_KEYS.TASK_CACHE, {});
      delete cache[taskId];
      return this.set(STORAGE_KEYS.TASK_CACHE, cache);
    } else {
      return this.remove(STORAGE_KEYS.TASK_CACHE);
    }
  }

  /**
   * 存储商品缓存
   * @param {string} key 缓存键
   * @param {Array} products 商品列表
   */
  setProductCache(key, products) {
    const cache = this.get(STORAGE_KEYS.PRODUCT_CACHE, {});
    cache[key] = {
      products,
      cacheTime: Date.now()
    };
    return this.set(STORAGE_KEYS.PRODUCT_CACHE, cache, 10 * 60 * 1000); // 10分钟缓存
  }

  /**
   * 获取商品缓存
   * @param {string} key 
   * @returns {Array|null}
   */
  getProductCache(key) {
    const cache = this.get(STORAGE_KEYS.PRODUCT_CACHE, {});
    const item = cache[key];
    
    if (item && (Date.now() - item.cacheTime < 10 * 60 * 1000)) {
      return item.products;
    }
    
    return null;
  }

  // ================ 搜索相关存储 ================

  /**
   * 添加搜索历史
   * @param {string} keyword 
   */
  addSearchHistory(keyword) {
    if (!keyword || keyword.trim() === '') return;
    
    const history = this.getSearchHistory();
    const trimmedKeyword = keyword.trim();
    
    // 移除重复项
    const index = history.indexOf(trimmedKeyword);
    if (index > -1) {
      history.splice(index, 1);
    }
    
    // 添加到开头
    history.unshift(trimmedKeyword);
    
    // 限制数量
    const maxHistory = 20;
    if (history.length > maxHistory) {
      history.splice(maxHistory);
    }
    
    return this.set(STORAGE_KEYS.SEARCH_HISTORY, history);
  }

  /**
   * 获取搜索历史
   * @returns {Array}
   */
  getSearchHistory() {
    return this.get(STORAGE_KEYS.SEARCH_HISTORY, []);
  }

  /**
   * 清除搜索历史
   */
  clearSearchHistory() {
    return this.remove(STORAGE_KEYS.SEARCH_HISTORY);
  }

  /**
   * 删除单个搜索历史
   * @param {string} keyword 
   */
  removeSearchHistory(keyword) {
    const history = this.getSearchHistory();
    const index = history.indexOf(keyword);
    
    if (index > -1) {
      history.splice(index, 1);
      return this.set(STORAGE_KEYS.SEARCH_HISTORY, history);
    }
    
    return false;
  }

  // ================ 导出相关存储 ================

  /**
   * 添加导出历史
   * @param {object} exportInfo 
   */
  addExportHistory(exportInfo) {
    const history = this.getExportHistory();
    
    const newExport = {
      id: Date.now().toString(),
      ...exportInfo,
      timestamp: new Date().toISOString()
    };
    
    history.unshift(newExport);
    
    // 限制数量
    const maxHistory = 50;
    if (history.length > maxHistory) {
      history.splice(maxHistory);
    }
    
    return this.set(STORAGE_KEYS.EXPORT_HISTORY, history);
  }

  /**
   * 获取导出历史
   * @returns {Array}
   */
  getExportHistory() {
    return this.get(STORAGE_KEYS.EXPORT_HISTORY, []);
  }

  /**
   * 清除导出历史
   */
  clearExportHistory() {
    return this.remove(STORAGE_KEYS.EXPORT_HISTORY);
  }

  /**
   * 删除单个导出记录
   * @param {string} exportId 
   */
  removeExportHistory(exportId) {
    const history = this.getExportHistory();
    const index = history.findIndex(item => item.id === exportId);
    
    if (index > -1) {
      history.splice(index, 1);
      return this.set(STORAGE_KEYS.EXPORT_HISTORY, history);
    }
    
    return false;
  }

  // ================ 应用设置存储 ================

  /**
   * 存储应用设置
   * @param {object} settings 
   */
  setAppSettings(settings) {
    const currentSettings = this.getAppSettings();
    const newSettings = { ...currentSettings, ...settings };
    return this.set(STORAGE_KEYS.APP_SETTINGS, newSettings);
  }

  /**
   * 获取应用设置
   * @returns {object}
   */
  getAppSettings() {
    return this.get(STORAGE_KEYS.APP_SETTINGS, {
      theme: 'auto', // auto, light, dark
      language: 'zh-CN',
      notifications: {
        newProduct: true,
        lowPriceAlert: true,
        taskStatus: true,
        system: true
      },
      sounds: {
        enabled: true,
        newProduct: true,
        lowPriceAlert: true
      },
      display: {
        showImages: true,
        imageQuality: 'medium', // low, medium, high
        listMode: 'card' // card, list
      },
      privacy: {
        analytics: true,
        crashReporting: true
      },
      performance: {
        imageCache: true,
        dataCache: true,
        preload: false
      }
    });
  }

  /**
   * 获取单个设置项
   * @param {string} key 
   * @param {any} defaultValue 
   * @returns {any}
   */
  getAppSetting(key, defaultValue = null) {
    const settings = this.getAppSettings();
    return this.getNestedValue(settings, key, defaultValue);
  }

  /**
   * 设置单个设置项
   * @param {string} key 
   * @param {any} value 
   */
  setAppSetting(key, value) {
    const settings = this.getAppSettings();
    this.setNestedValue(settings, key, value);
    return this.setAppSettings(settings);
  }

  // ================ 工具方法 ================

  /**
   * 获取嵌套对象的值
   * @param {object} obj 
   * @param {string} key 
   * @param {any} defaultValue 
   * @returns {any}
   */
  getNestedValue(obj, key, defaultValue = null) {
    const keys = key.split('.');
    let result = obj;
    
    for (const k of keys) {
      if (result && typeof result === 'object' && k in result) {
        result = result[k];
      } else {
        return defaultValue;
      }
    }
    
    return result;
  }

  /**
   * 设置嵌套对象的值
   * @param {object} obj 
   * @param {string} key 
   * @param {any} value 
   */
  setNestedValue(obj, key, value) {
    const keys = key.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  /**
   * 获取存储使用情况
   * @returns {object}
   */
  getUsage() {
    const info = this.getInfo();
    const usage = {
      total: info.limitSize,
      used: info.currentSize,
      available: info.limitSize - info.currentSize,
      percentage: Math.round((info.currentSize / info.limitSize) * 100),
      keys: info.keys.length
    };
    
    return usage;
  }

  /**
   * 清理过期数据
   */
  cleanup() {
    try {
      const info = this.getInfo();
      let cleanedCount = 0;
      
      info.keys.forEach(key => {
        try {
          const itemStr = wx.getStorageSync(key);
          if (itemStr) {
            const item = JSON.parse(itemStr);
            if (item.expiry && Date.now() > item.expiry) {
              this.remove(key);
              cleanedCount++;
            }
          }
        } catch (error) {
          // 数据格式错误，删除
          this.remove(key);
          cleanedCount++;
        }
      });
      
      console.log(`清理了 ${cleanedCount} 个过期数据`);
      return cleanedCount;
    } catch (error) {
      console.error('清理数据失败:', error);
      return 0;
    }
  }

  /**
   * 导出所有数据（用于备份）
   * @returns {object}
   */
  exportAll() {
    try {
      const info = this.getInfo();
      const data = {};
      
      info.keys.forEach(key => {
        try {
          data[key] = wx.getStorageSync(key);
        } catch (error) {
          console.warn(`导出数据失败: ${key}`, error);
        }
      });
      
      return {
        version: '1.0',
        timestamp: new Date().toISOString(),
        data
      };
    } catch (error) {
      console.error('导出数据失败:', error);
      return null;
    }
  }

  /**
   * 导入数据（用于恢复备份）
   * @param {object} backupData 
   */
  importAll(backupData) {
    try {
      if (!backupData || !backupData.data) {
        throw new Error('无效的备份数据');
      }
      
      // 清空现有数据
      this.clear();
      
      // 导入数据
      Object.entries(backupData.data).forEach(([key, value]) => {
        try {
          wx.setStorageSync(key, value);
        } catch (error) {
          console.warn(`导入数据失败: ${key}`, error);
        }
      });
      
      console.log('数据导入成功');
      return true;
    } catch (error) {
      console.error('导入数据失败:', error);
      return false;
    }
  }
}

// 创建单例实例
const storage = new Storage();

// 应用启动时清理过期数据
try {
  storage.cleanup();
} catch (error) {
  console.warn('启动清理失败:', error);
}

module.exports = storage;
