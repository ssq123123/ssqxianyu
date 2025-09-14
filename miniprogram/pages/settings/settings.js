// pages/settings/settings.js
Page({
  data: {
    soundAlert: true,
    defaultInterval: 30
  },

  onLoad() {
    // 可从本地读取设置，这里先使用默认值
  },

  onToggleSound(e) {
    this.setData({ soundAlert: e.detail.value });
  },

  onIntervalChange(e) {
    this.setData({ defaultInterval: e.detail });
  },

  onClearCache() {
    try {
      wx.clearStorageSync();
      wx.showToast({ title: '已清理', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '清理失败', icon: 'none' });
    }
  }
});