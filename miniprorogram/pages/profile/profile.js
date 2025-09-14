// pages/profile/profile.js
Page({
  onGoSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
  onLogout() {
    wx.showToast({ title: '已退出(示例)', icon: 'none' });
  }
});

