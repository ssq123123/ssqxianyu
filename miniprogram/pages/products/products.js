const api = require('../../utils/api');

Page({
  data: {
    products: [],
    priceOptions: [
      { text: '全部价格', value: 'all' },
      { text: '¥0-¥100', value: '0-100' },
      { text: '¥100-¥500', value: '100-500' },
      { text: '¥500-¥2000', value: '500-2000' }
    ],
    sortOptions: [
      { text: '最新发布', value: 'time' },
      { text: '价格从低到高', value: 'priceAsc' },
      { text: '价格从高到低', value: 'priceDesc' }
    ]
  },

  async onLoad(options) {
    await this.loadProducts();
  },

  async loadProducts(params = {}) {
    try {
      const res = await api.getProducts(params);
      if (res.success) {
        this.setData({ products: res.data.products || [] });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onSearch(e) {
    const keyword = e.detail;
    this.loadProducts({ keyword });
  },

  onTapProduct(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${id}` });
  }
});