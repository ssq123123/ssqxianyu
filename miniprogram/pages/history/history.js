const api = require('../../utils/api');

Page({
  data: {
    records: []
  },

  async onLoad() {
    await this.loadHistory();
  },

  async loadHistory() {
    try {
      const res = await api.getMonitorStatus();
      if (res.success) {
        // 简化：把最近发现的商品/轮次信息映射成记录
        const recent = res.data?.recent || [];
        this.setData({ records: recent });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  }
});