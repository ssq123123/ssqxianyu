const api = require('../../utils/api');

Page({
  data: {
    user: null
  },

  async onShow() {
    try {
      const res = await api.getUserProfile();
      if (res.success) {
        this.setData({ user: res.data });
      }
    } catch (e) {}
  }
});