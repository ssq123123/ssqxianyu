const api = require('../../utils/api');
const storage = require('../../utils/storage');

Page({
  data: {
    // 页面状态
    loading: false,
    pageAction: 'login', // login, cookie
    
    // 用户信息
    userInfo: null,
    canIUseGetUserProfile: false,
    
    // Cookie相关
    cookieText: '',
    cookieStatus: {
      hasCookie: false,
      isExpired: true,
      daysUntilExpire: 0
    },
    
    // 表单状态
    agreementChecked: false,
    
    // WebView相关
    showWebView: false,
    webViewUrl: 'https://www.goofish.com'
  },

  onLoad(options) {
    console.log('登录页面加载', options);
    
    // 检查页面参数
    if (options.action === 'cookie') {
      this.setData({ pageAction: 'cookie' });
    }
    
    // 检查是否支持getUserProfile
    if (wx.getUserProfile) {
      this.setData({
        canIUseGetUserProfile: true
      });
    }
    
    // 检查当前登录状态
    this.checkCurrentStatus();
  },

  onShow() {
    // 页面显示时检查Cookie状态
    if (this.data.pageAction === 'cookie') {
      this.loadCookieStatus();
    }
  },

  /**
   * 检查当前状态
   */
  checkCurrentStatus() {
    const app = getApp();
    const isLogin = app.checkLogin();
    
    if (isLogin && this.data.pageAction === 'login') {
      // 已登录，跳转到首页
      wx.reLaunch({
        url: '/pages/index/index'
      });
      return;
    }
    
    // 加载Cookie状态
    if (this.data.pageAction === 'cookie' || isLogin) {
      this.loadCookieStatus();
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
      console.warn('加载Cookie状态失败:', error);
    }
  },

  /**
   * 获取用户信息（新版API）
   */
  getUserProfile() {
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        console.log('获取用户信息成功', res.userInfo);
        this.setData({
          userInfo: res.userInfo
        });
        this.doLogin(res.userInfo);
      },
      fail: (error) => {
        console.error('获取用户信息失败', error);
        wx.showToast({
          title: '需要授权才能使用',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 获取用户信息（兼容旧版）
   */
  onGetUserInfo(e) {
    if (e.detail.userInfo) {
      console.log('获取用户信息成功', e.detail.userInfo);
      this.setData({
        userInfo: e.detail.userInfo
      });
      this.doLogin(e.detail.userInfo);
    } else {
      wx.showToast({
        title: '需要授权才能使用',
        icon: 'none'
      });
    }
  },

  /**
   * 执行登录
   */
  async doLogin(userInfo) {
    if (!this.data.agreementChecked) {
      wx.showToast({
        title: '请先同意用户协议',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    try {
      const app = getApp();
      const result = await app.login(userInfo);

      if (result.success) {
        wx.showToast({
          title: '登录成功',
          icon: 'success'
        });

        // 延迟跳转，让用户看到成功提示
        setTimeout(() => {
          wx.reLaunch({
            url: '/pages/index/index'
          });
        }, 1500);
      } else {
        throw new Error(result.error?.message || '登录失败');
      }
    } catch (error) {
      console.error('登录失败:', error);
      wx.showToast({
        title: error.message || '登录失败，请重试',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * Cookie输入框变化
   */
  onCookieInput(e) {
    this.setData({
      cookieText: e.detail.value
    });
  },

  /**
   * 保存Cookie
   */
  async onSaveCookie() {
    const cookieText = this.data.cookieText.trim();
    
    if (!cookieText) {
      wx.showToast({
        title: 'Cookie不能为空',
        icon: 'none'
      });
      return;
    }

    // 简单验证Cookie格式
    if (!cookieText.includes('_m_h5_tk=')) {
      wx.showModal({
        title: 'Cookie格式提醒',
        content: '检测到Cookie中可能缺少必要的认证信息，是否继续保存？',
        success: (res) => {
          if (res.confirm) {
            this.saveCookieToServer(cookieText);
          }
        }
      });
      return;
    }

    this.saveCookieToServer(cookieText);
  },

  /**
   * 保存Cookie到服务器
   */
  async saveCookieToServer(cookie) {
    this.setData({ loading: true });

    try {
      const response = await api.updateCookie(cookie);

      if (response.success) {
        wx.showToast({
          title: 'Cookie保存成功',
          icon: 'success'
        });

        // 清空输入框
        this.setData({
          cookieText: ''
        });

        // 重新加载状态
        await this.loadCookieStatus();

        // 如果是从首页跳转过来的，返回首页
        setTimeout(() => {
          if (this.data.pageAction === 'cookie') {
            wx.navigateBack();
          }
        }, 1500);
      }
    } catch (error) {
      console.error('保存Cookie失败:', error);
      wx.showToast({
        title: error.message || 'Cookie保存失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 粘贴Cookie
   */
  onPasteCookie() {
    wx.getClipboardData({
      success: (res) => {
        const clipboardData = res.data.trim();
        if (clipboardData) {
          this.setData({
            cookieText: clipboardData
          });
          wx.showToast({
            title: '已粘贴剪贴板内容',
            icon: 'success'
          });
        } else {
          wx.showToast({
            title: '剪贴板为空',
            icon: 'none'
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: '无法访问剪贴板',
          icon: 'none'
        });
      }
    });
  },

  /**
   * 清空Cookie输入
   */
  onClearCookie() {
    this.setData({
      cookieText: ''
    });
  },

  /**
   * 显示Cookie获取教程
   */
  onShowCookieGuide() {
    wx.showModal({
      title: 'Cookie获取教程',
      content: `1. 在浏览器中打开闲鱼网站并登录
2. 按F12打开开发者工具
3. 点击Network(网络)标签
4. 刷新页面，找到第一个请求
5. 在Headers中找到Cookie字段并复制
6. 将复制的内容粘贴到输入框中`,
      confirmText: '我知道了',
      showCancel: false
    });
  },

  /**
   * 打开WebView获取Cookie
   */
  onOpenWebView() {
    wx.showModal({
      title: '自动获取Cookie',
      content: '将打开闲鱼网站，请在网站中登录您的账号，登录成功后返回小程序',
      confirmText: '打开网站',
      success: (res) => {
        if (res.confirm) {
          this.setData({ showWebView: true });
        }
      }
    });
  },

  /**
   * WebView消息处理
   */
  onWebViewMessage(e) {
    console.log('WebView消息:', e.detail.data);
    
    // 处理从WebView传来的Cookie信息
    const messages = e.detail.data;
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'cookie' && lastMessage.cookie) {
        this.setData({
          cookieText: lastMessage.cookie,
          showWebView: false
        });
        
        wx.showToast({
          title: 'Cookie获取成功',
          icon: 'success'
        });
      }
    }
  },

  /**
   * 关闭WebView
   */
  onCloseWebView() {
    this.setData({ showWebView: false });
  },

  /**
   * 同意协议状态改变
   */
  onAgreementChange(e) {
    const checked = Array.isArray(e.detail.value) ? e.detail.value.includes('agree') : !!e.detail.value;
    this.setData({ agreementChecked: checked });
  },

  /**
   * 查看用户协议
   */
  onViewAgreement() {
    wx.showModal({
      title: '用户服务协议',
      content: `感谢您使用闲鱼监控系统！

1. 本应用仅用于个人学习和研究目的
2. 请遵守闲鱼平台的相关规定和法律法规
3. 我们不会存储您的个人敏感信息
4. 您的Cookie信息将被加密存储
5. 我们不对监控结果的准确性承担责任

使用本应用即表示您同意以上条款。`,
      confirmText: '同意',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            agreementChecked: true
          });
        }
      }
    });
  },

  /**
   * 查看隐私政策
   */
  onViewPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: `我们重视您的隐私安全：

1. 收集信息：仅收集必要的用户信息和Cookie
2. 信息使用：仅用于提供监控服务
3. 信息保护：采用加密技术保护您的数据
4. 信息分享：不会向第三方分享您的个人信息
5. 数据删除：您可随时删除个人数据

如有疑问，请联系我们。`,
      confirmText: '我知道了',
      showCancel: false
    });
  },

  /**
   * 切换到登录模式
   */
  onSwitchToLogin() {
    this.setData({ pageAction: 'login' });
  },

  /**
   * 切换到Cookie模式
   */
  onSwitchToCookie() {
    this.setData({ pageAction: 'cookie' });
  },

  /**
   * 返回首页
   */
  onBackHome() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  /**
   * 测试Cookie有效性
   */
  async onTestCookie() {
    const cookieText = this.data.cookieText.trim();
    
    if (!cookieText) {
      wx.showToast({
        title: '请先输入Cookie',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '测试中...' });

    try {
      // 这里可以调用后端接口测试Cookie有效性
      // 目前简单检查格式
      if (cookieText.includes('_m_h5_tk=')) {
        wx.showToast({
          title: 'Cookie格式正确',
          icon: 'success'
        });
      } else {
        wx.showToast({
          title: 'Cookie格式可能有误',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.showToast({
        title: '测试失败',
        icon: 'error'
      });
    } finally {
      wx.hideLoading();
    }
  }
});