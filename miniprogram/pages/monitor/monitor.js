const api = require('../../utils/api');
const storage = require('../../utils/storage');

Page({
  data: {
    // 表单数据
    formData: {
      name: '',
      description: '',
      keywords: [{ keyword: '', enabled: true, priority: 1 }],
      interval: 30,
      monitorPages: 3,
      minPrice: 0,
      maxPrice: 999999,
      enableAlert: false,
      alertPrice: 100,
      options: {
        multiImages: true,
        soundAlert: true,
        autoExport: false,
        exportFormat: 'excel'
      }
    },
    
    // 编辑状态
    isEdit: false,
    taskId: '',
    
    // 页面状态
    loading: false,
    saving: false,
    
    // 用户权限信息
    userInfo: null,
    membership: {
      level: 'free',
      features: {
        maxTasks: 3,
        maxKeywordsPerTask: 5,
        maxMonitorPages: 5
      }
    },
    
    // 表单验证
    errors: {},
    
    // 选项数据
    intervalOptions: [
      { label: '10秒', value: 10 },
      { label: '30秒', value: 30 },
      { label: '1分钟', value: 60 },
      { label: '2分钟', value: 120 },
      { label: '5分钟', value: 300 },
      { label: '10分钟', value: 600 }
    ],
    
    pagesOptions: [
      { label: '1页', value: 1 },
      { label: '2页', value: 2 },
      { label: '3页', value: 3 },
      { label: '5页', value: 5 },
      { label: '10页', value: 10 }
    ],
    
    // 快速价格选项
    quickPrices: [
      { label: '不限', min: 0, max: 999999 },
      { label: '50以下', min: 0, max: 50 },
      { label: '100以下', min: 0, max: 100 },
      { label: '200以下', min: 0, max: 200 },
      { label: '50-200', min: 50, max: 200 },
      { label: '100-500', min: 100, max: 500 },
      { label: '500以上', min: 500, max: 999999 }
    ]
  },

  onLoad(options) {
    console.log('监控页面加载', options);
    
    // 检查是否是编辑模式
    if (options.id) {
      this.setData({
        isEdit: true,
        taskId: options.id
      });
      this.loadTaskData(options.id);
    } else {
      // 新建模式，加载默认设置
      this.loadDefaultSettings();
    }
    
    // 加载用户信息
    this.loadUserInfo();
  },

  onShow() {
    // 页面显示时检查用户权限
    this.checkUserPermissions();
  },

  /**
   * 加载用户信息
   */
  loadUserInfo() {
    const app = getApp();
    const userInfo = app.getUserInfo();
    
    if (userInfo) {
      this.setData({
        userInfo,
        membership: userInfo.membership || this.data.membership
      });
    }
  },

  /**
   * 检查用户权限
   */
  checkUserPermissions() {
    const { membership } = this.data;
    const features = membership.features;
    
    // 更新选项限制
    const limitedPagesOptions = this.data.pagesOptions.filter(
      option => option.value <= features.maxMonitorPages
    );
    
    this.setData({
      pagesOptions: limitedPagesOptions
    });
    
    // 检查当前设置是否超出权限
    if (this.data.formData.monitorPages > features.maxMonitorPages) {
      this.setData({
        'formData.monitorPages': features.maxMonitorPages
      });
    }
    
    // 检查关键词数量
    const enabledKeywords = this.data.formData.keywords.filter(k => k.enabled);
    if (enabledKeywords.length > features.maxKeywordsPerTask) {
      wx.showToast({
        title: `最多设置${features.maxKeywordsPerTask}个关键词`,
        icon: 'none'
      });
    }
  },

  /**
   * 加载任务数据（编辑模式）
   */
  async loadTaskData(taskId) {
    this.setData({ loading: true });
    
    try {
      const response = await api.getMonitorTask(taskId);
      
      if (response.success) {
        const task = response.data.task;
        
        this.setData({
          formData: {
            name: task.name || '',
            description: task.description || '',
            keywords: task.keywords || [{ keyword: '', enabled: true, priority: 1 }],
            interval: task.interval || 30,
            monitorPages: task.monitorPages || 3,
            minPrice: task.minPrice || 0,
            maxPrice: task.maxPrice || 999999,
            enableAlert: task.enableAlert || false,
            alertPrice: task.alertPrice || 100,
            options: task.options || {
              multiImages: true,
              soundAlert: true,
              autoExport: false,
              exportFormat: 'excel'
            }
          }
        });
      }
    } catch (error) {
      console.error('加载任务数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'error'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 加载默认设置
   */
  loadDefaultSettings() {
    const defaultSettings = storage.getMonitorSettings();
    
    this.setData({
      'formData.interval': defaultSettings.defaultInterval,
      'formData.monitorPages': defaultSettings.defaultPages,
      'formData.enableAlert': defaultSettings.enableAlert,
      'formData.alertPrice': defaultSettings.alertPrice,
      'formData.options.soundAlert': defaultSettings.soundAlert,
      'formData.options.multiImages': defaultSettings.multiImages
    });
  },

  /**
   * 表单字段变化
   */
  onFieldChange(e) {
    const { field } = e.currentTarget.dataset;
    const { value } = e.detail;
    
    this.setData({
      [`formData.${field}`]: value
    });
    
    // 清除对应字段的错误
    if (this.data.errors[field]) {
      this.setData({
        [`errors.${field}`]: ''
      });
    }
  },

  /**
   * 开关变化
   */
  onSwitchChange(e) {
    const { field } = e.currentTarget.dataset;
    const { value } = e.detail;
    
    this.setData({
      [`formData.${field}`]: value
    });
  },

  /**
   * 步进器变化
   */
  onStepperChange(e) {
    const { field } = e.currentTarget.dataset;
    const { value } = e.detail;
    
    this.setData({
      [`formData.${field}`]: value
    });
  },

  /**
   * 添加关键词
   */
  onAddKeyword() {
    const keywords = [...this.data.formData.keywords];
    const { maxKeywordsPerTask } = this.data.membership.features;
    
    if (keywords.length >= maxKeywordsPerTask) {
      wx.showToast({
        title: `最多添加${maxKeywordsPerTask}个关键词`,
        icon: 'none'
      });
      return;
    }
    
    keywords.push({
      keyword: '',
      enabled: true,
      priority: 1
    });
    
    this.setData({
      'formData.keywords': keywords
    });
  },

  /**
   * 删除关键词
   */
  onDeleteKeyword(e) {
    const { index } = e.currentTarget.dataset;
    const keywords = [...this.data.formData.keywords];
    
    if (keywords.length <= 1) {
      wx.showToast({
        title: '至少需要一个关键词',
        icon: 'none'
      });
      return;
    }
    
    keywords.splice(index, 1);
    
    this.setData({
      'formData.keywords': keywords
    });
  },

  /**
   * 关键词内容变化
   */
  onKeywordChange(e) {
    const { index } = e.currentTarget.dataset;
    const { value } = e.detail;
    const keywords = [...this.data.formData.keywords];
    
    keywords[index].keyword = value.trim();
    
    this.setData({
      'formData.keywords': keywords
    });
  },

  /**
   * 关键词启用状态变化
   */
  onKeywordToggle(e) {
    const { index } = e.currentTarget.dataset;
    const { value } = e.detail;
    const keywords = [...this.data.formData.keywords];
    
    keywords[index].enabled = value;
    
    this.setData({
      'formData.keywords': keywords
    });
  },

  /**
   * 快速设置价格范围
   */
  onQuickPrice(e) {
    const { min, max } = e.currentTarget.dataset;
    
    this.setData({
      'formData.minPrice': min,
      'formData.maxPrice': max
    });
  },

  /**
   * 表单验证
   */
  validateForm() {
    const { formData } = this.data;
    const errors = {};
    
    // 验证任务名称
    if (!formData.name.trim()) {
      errors.name = '请输入任务名称';
    } else if (formData.name.length > 50) {
      errors.name = '任务名称不能超过50个字符';
    }
    
    // 验证关键词
    const enabledKeywords = formData.keywords.filter(k => k.enabled && k.keyword.trim());
    if (enabledKeywords.length === 0) {
      errors.keywords = '至少需要一个有效的关键词';
    }
    
    // 检查是否有空关键词
    const hasEmptyKeyword = formData.keywords.some(k => k.enabled && !k.keyword.trim());
    if (hasEmptyKeyword) {
      errors.keywords = '启用的关键词不能为空';
    }
    
    // 验证价格范围
    if (formData.minPrice < 0) {
      errors.minPrice = '最低价格不能为负数';
    }
    
    if (formData.maxPrice < 0) {
      errors.maxPrice = '最高价格不能为负数';
    }
    
    if (formData.minPrice > formData.maxPrice) {
      errors.priceRange = '最低价格不能高于最高价格';
    }
    
    // 验证预警价格
    if (formData.enableAlert) {
      if (!formData.alertPrice || formData.alertPrice <= 0) {
        errors.alertPrice = '启用低价预警时必须设置有效的预警价格';
      }
    }
    
    // 验证监控间隔
    if (formData.interval < 10) {
      errors.interval = '监控间隔不能小于10秒';
    }
    
    this.setData({ errors });
    
    return Object.keys(errors).length === 0;
  },

  /**
   * 保存任务
   */
  async onSaveTask() {
    if (!this.validateForm()) {
      wx.showToast({
        title: '请检查表单输入',
        icon: 'none'
      });
      return;
    }
    
    this.setData({ saving: true });
    
    try {
      const { formData, isEdit, taskId } = this.data;
      
      // 过滤掉空的关键词
      const validKeywords = formData.keywords.filter(k => k.keyword.trim());
      
      const taskData = {
        ...formData,
        keywords: validKeywords.map(k => ({
          keyword: k.keyword.trim(),
          enabled: k.enabled,
          priority: k.priority || 1
        }))
      };
      
      let response;
      
      if (isEdit) {
        response = await api.updateMonitorTask(taskId, taskData);
      } else {
        response = await api.createMonitorTask(taskData);
      }
      
      if (response.success) {
        // 保存用户设置
        storage.setMonitorSettings({
          defaultInterval: formData.interval,
          defaultPages: formData.monitorPages,
          enableAlert: formData.enableAlert,
          alertPrice: formData.alertPrice,
          soundAlert: formData.options.soundAlert,
          multiImages: formData.options.multiImages
        });
        
        wx.showToast({
          title: isEdit ? '更新成功' : '创建成功',
          icon: 'success'
        });
        
        // 延迟返回
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    } catch (error) {
      console.error('保存任务失败:', error);
      wx.showToast({
        title: error.message || '保存失败',
        icon: 'error'
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 预览任务
   */
  onPreviewTask() {
    if (!this.validateForm()) {
      wx.showToast({
        title: '请检查表单输入',
        icon: 'none'
      });
      return;
    }
    
    const { formData } = this.data;
    const enabledKeywords = formData.keywords
      .filter(k => k.enabled && k.keyword.trim())
      .map(k => k.keyword);
    
    const previewContent = `
任务名称: ${formData.name}
监控关键词: ${enabledKeywords.join(', ')}
监控间隔: ${formData.interval}秒
监控页数: ${formData.monitorPages}页
价格范围: ¥${formData.minPrice} - ¥${formData.maxPrice}
低价预警: ${formData.enableAlert ? `启用 (¥${formData.alertPrice})` : '未启用'}
    `.trim();
    
    wx.showModal({
      title: '任务预览',
      content: previewContent,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /**
   * 测试监控
   */
  async onTestMonitor() {
    if (!this.validateForm()) {
      wx.showToast({
        title: '请检查表单输入',
        icon: 'none'
      });
      return;
    }
    
    const { formData } = this.data;
    const firstKeyword = formData.keywords.find(k => k.enabled && k.keyword.trim());
    
    if (!firstKeyword) {
      wx.showToast({
        title: '请至少设置一个关键词',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '测试中...' });
    
    try {
      const res = await api.getProducts({ keyword: firstKeyword.keyword, limit: 5 });
      const count = res.success ? (res.data.pagination?.total || 0) : 0;

      wx.showModal({
        title: '测试结果',
        content: `关键词"${firstKeyword.keyword}"测试成功！\n\n最近可获取 ${count} 条记录`,
        showCancel: false,
        confirmText: '知道了'
      });
    } catch (error) {
      wx.showToast({
        title: '测试失败',
        icon: 'error'
      });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 导入搜索历史
   */
  onImportHistory() {
    const searchHistory = storage.getSearchHistory();
    
    if (searchHistory.length === 0) {
      wx.showToast({
        title: '暂无搜索历史',
        icon: 'none'
      });
      return;
    }
    
    wx.showActionSheet({
      itemList: searchHistory.slice(0, 6), // 最多显示6个
      success: (res) => {
        const selectedKeyword = searchHistory[res.tapIndex];
        
        // 添加到关键词列表
        const keywords = [...this.data.formData.keywords];
        
        // 检查是否已存在
        const exists = keywords.some(k => k.keyword === selectedKeyword);
        if (exists) {
          wx.showToast({
            title: '关键词已存在',
            icon: 'none'
          });
          return;
        }
        
        // 找到第一个空的或禁用的关键词位置
        const emptyIndex = keywords.findIndex(k => !k.keyword.trim() || !k.enabled);
        
        if (emptyIndex >= 0) {
          keywords[emptyIndex] = {
            keyword: selectedKeyword,
            enabled: true,
            priority: 1
          };
        } else {
          // 没有空位置，添加新的
          const maxKeywords = this.data.membership.features.maxKeywordsPerTask;
          if (keywords.length < maxKeywords) {
            keywords.push({
              keyword: selectedKeyword,
              enabled: true,
              priority: 1
            });
          } else {
            wx.showToast({
              title: `最多${maxKeywords}个关键词`,
              icon: 'none'
            });
            return;
          }
        }
        
        this.setData({
          'formData.keywords': keywords
        });
      }
    });
  },

  /**
   * 重置表单
   */
  onResetForm() {
    wx.showModal({
      title: '重置确认',
      content: '确定要重置所有设置吗？此操作不可撤销。',
      success: (res) => {
        if (res.confirm) {
          this.loadDefaultSettings();
          
          this.setData({
            'formData.name': '',
            'formData.description': '',
            'formData.keywords': [{ keyword: '', enabled: true, priority: 1 }],
            errors: {}
          });
          
          wx.showToast({
            title: '已重置',
            icon: 'success'
          });
        }
      }
    });
  }
});