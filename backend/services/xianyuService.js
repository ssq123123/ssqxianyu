const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  sharp = null;
}
const logger = require('../utils/logger');

class XianyuService {
  constructor() {
    // 闲鱼API配置（从Python代码移植）
    this.API_URL = "https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/";
    this.APP_KEY = "34839810";
    this.USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0";
    this.REQUEST_DELAY = 2000; // 2秒延迟
    this.SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'bmp'];
    this.IMAGE_FOLDER = path.join(__dirname, '../public/images');
    
    // 确保图片目录存在
    if (!fs.existsSync(this.IMAGE_FOLDER)) {
      fs.mkdirSync(this.IMAGE_FOLDER, { recursive: true });
    }
  }

  /**
   * 从Cookie中提取Token
   * @param {string} cookie - 用户Cookie
   * @returns {string|null} - 提取的Token
   */
  extractToken(cookie) {
    try {
      if (!cookie || !cookie.includes('_m_h5_tk=')) {
        logger.error('Cookie中缺少_m_h5_tk值');
        return null;
      }

      const startIdx = cookie.indexOf('_m_h5_tk=') + '_m_h5_tk='.length;
      const endIdx = cookie.indexOf(';', startIdx);
      const endIndex = endIdx === -1 ? cookie.length : endIdx;

      const m_h5_tk_value = cookie.substring(startIdx, endIndex);
      const token = m_h5_tk_value.split('_')[0];
      
      return token;
    } catch (error) {
      logger.error('提取Token失败:', error);
      return null;
    }
  }

  /**
   * 生成签名和请求数据（支持排序和分页）
   * @param {string} keyword - 搜索关键词
   * @param {number} page - 页码
   * @param {string} token - 认证Token
   * @param {string} sortValue - 排序字段（默认按发布时间）
   * @returns {object} - 包含签名、时间戳和请求数据的对象
   */
  generateSign(keyword, page, token, sortValue = "gmtCreate") {
    try {
      // 生成当前时间戳（毫秒级）
      const timestamp = Date.now();

      // 构建请求数据 - 按时间排序
      const requestData = JSON.stringify({
        pageNumber: page,
        keyword: keyword,
        fromFilter: false,
        rowsPerPage: 30,
        sortValue: sortValue,
        sortField: "DESC",
        customDistance: "",
        gps: "",
        propValueStr: "",
        customGps: "",
        searchReqFromPage: "pcSearch",
        extraFilterValue: "",
        userPositionJson: ""
      });

      // 构建签名原始字符串
      const signStr = `${token}&${timestamp}&${this.APP_KEY}&${requestData}`;

      // 计算MD5签名
      const sign = crypto.createHash('md5').update(signStr, 'utf8').digest('hex');

      return {
        sign,
        timestamp,
        requestData
      };
    } catch (error) {
      logger.error('生成签名失败:', error);
      throw error;
    }
  }

  /**
   * 获取商品数据（按页）
   * @param {string} keyword - 搜索关键词
   * @param {number} page - 页码
   * @param {string} cookie - 用户Cookie
   * @returns {Array|null} - 商品数据数组
   */
  async fetchProducts(keyword, page, cookie) {
    try {
      // 提取token
      const token = this.extractToken(cookie);
      if (!token) {
        return { error: 'TOKEN_INVALID', message: '无效的Cookie或Token' };
      }

      // 生成签名和请求参数
      const { sign, timestamp, requestData } = this.generateSign(keyword, page, token);

      // 构建请求头
      const headers = {
        'cookie': cookie,
        'origin': 'https://www.goofish.com',
        'referer': 'https://www.goofish.com/',
        'user-agent': this.USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded'
      };

      // 构建请求参数
      const params = {
        jsv: '2.7.2',
        appKey: this.APP_KEY,
        t: timestamp,
        sign: sign,
        v: '1.0',
        type: 'originaljson',
        accountSite: 'xianyu',
        dataType: 'json',
        timeout: '20000',
        api: 'mtop.taobao.idlemtopsearch.pc.search'
      };

      // 构建查询字符串
      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key])}`)
        .join('&');

      // 发送POST请求
      const response = await axios({
        method: 'POST',
        url: `${this.API_URL}?${queryString}`,
        headers: headers,
        data: `data=${encodeURIComponent(requestData)}`,
        timeout: 15000
      });

      // 检查响应状态
      if (response.status !== 200) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const result = response.data;

      // 检查是否Token过期
      if (result.ret && result.ret[0] && result.ret[0].includes('FAIL_SYS_TOKEN_EXOIRED')) {
        return { error: 'TOKEN_EXPIRED', message: 'Token已过期，请重新登录获取Cookie' };
      }

      // 检查返回数据是否包含商品列表
      if (result.data && result.data.resultList) {
        return result.data.resultList;
      } else {
        logger.warn(`第${page}页响应数据格式异常:`, result);
        return null;
      }

    } catch (error) {
      logger.error(`第${page}页请求失败:`, error.message);
      return null;
    }
  }

  /**
   * 解析商品数据
   * @param {object} product - 原始商品数据
   * @returns {object|null} - 解析后的商品数据
   */
  parseProduct(product) {
    try {
      const itemData = product.data?.item?.main?.exContent;
      const clickParams = product.data?.item?.main?.clickParam?.args;

      if (!itemData || !clickParams) {
        return null;
      }

      // 提取基本信息
      const picUrl = itemData.picUrl || clickParams.picUrl || "无图片链接";
      const userName = (itemData.userNick || "未知用户").trim();
      const title = (itemData.title || "").trim();
      const postFee = clickParams.tagname || "不包邮";
      const description = `${postFee} +++ ${title}`;
      const itemId = itemData.itemId || "";
      const productUrl = itemId ? `https://www.goofish.com/item?id=${itemId}` : "";
      const price = clickParams.price || "未知";
      const area = (itemData.area || "未知地区").trim();

      // 提取多图片URL
      const allImages = [picUrl].filter(url => url !== "无图片链接");
      
      // 递归提取更多图片URL
      try {
        const foundUrls = this.extractImageUrls(product.data.item);
        foundUrls.forEach(url => {
          if (url && !allImages.includes(url) && (url.includes('http') || url.includes('//'))) {
            if (!['avatar', 'icon', 'logo'].some(exclude => url.toLowerCase().includes(exclude))) {
              allImages.push(url);
            }
          }
        });
      } catch (e) {
        // 忽略图片提取错误
      }

      return {
        userName,
        description,
        url: productUrl,
        price,
        area,
        picUrl,
        itemId,
        allImages: allImages.slice(0, 3), // 限制最多3张图片
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('商品数据解析异常:', error);
      return null;
    }
  }

  /**
   * 递归提取图片URL
   * @param {object} data - 数据对象
   * @param {Set} foundUrls - 已找到的URL集合
   * @returns {Array} - 图片URL数组
   */
  extractImageUrls(data, foundUrls = new Set()) {
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data)) {
        data.forEach(item => this.extractImageUrls(item, foundUrls));
      } else {
        Object.keys(data).forEach(key => {
          if (['pic', 'img', 'image', 'photo'].some(keyword => key.toLowerCase().includes(keyword))) {
            const value = data[key];
            if (typeof value === 'string' && (value.includes('http') || value.includes('//'))) {
              foundUrls.add(value);
            } else if (Array.isArray(value)) {
              value.forEach(item => {
                if (typeof item === 'string' && (item.includes('http') || item.includes('//'))) {
                  foundUrls.add(item);
                } else if (typeof item === 'object' && item.url) {
                  foundUrls.add(item.url);
                }
              });
            }
          } else {
            this.extractImageUrls(data[key], foundUrls);
          }
        });
      }
    }
    return Array.from(foundUrls);
  }

  /**
   * 下载图片到本地
   * @param {string} picUrl - 图片URL
   * @param {string} itemId - 商品ID
   * @param {string} cookie - 用户Cookie
   * @param {number} imgIndex - 图片索引
   * @returns {string|null} - 本地图片路径
   */
  async downloadImage(picUrl, itemId, cookie, imgIndex = 0) {
    try {
      // 跳过无图片链接的情况
      if (picUrl === "无图片链接" || !picUrl) {
        return null;
      }

      // 处理URL中的特殊字符，补全协议头
      let processedUrl = picUrl;
      if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
        processedUrl = processedUrl.startsWith('//') ? `http:${processedUrl}` : `https://${processedUrl}`;
      }

      // 提取并验证文件后缀
      let fileExt = processedUrl.split('.').pop().split('?')[0].toLowerCase();
      if (!this.SUPPORTED_IMAGE_FORMATS.includes(fileExt)) {
        fileExt = 'jpg'; // 强制使用支持的格式
      }

      // 生成文件名
      const fileName = imgIndex === 0 
        ? `${itemId}.${fileExt}` 
        : `${itemId}_${imgIndex}.${fileExt}`;
      const filePath = path.join(this.IMAGE_FOLDER, fileName);

      // 已下载则直接返回路径
      if (fs.existsSync(filePath)) {
        return `/images/${fileName}`;
      }

      // 下载图片
      const headers = {
        'User-Agent': this.USER_AGENT,
        'Cookie': cookie,
        'Referer': 'https://www.goofish.com'
      };

      const response = await axios({
        method: 'GET',
        url: processedUrl,
        headers: headers,
        responseType: 'stream',
        timeout: 10000
      });

      // 保存图片
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          try {
            if (sharp) {
              // 使用 Sharp 优化图片（若可用）
              await sharp(filePath)
                .resize(800, 600, {
                  fit: 'inside',
                  withoutEnlargement: true
                })
                .jpeg({ quality: 85 })
                .toFile(filePath.replace(`.${fileExt}`, '_optimized.jpg'));

              // 删除原始文件，重命名优化后的文件
              fs.unlinkSync(filePath);
              fs.renameSync(
                filePath.replace(`.${fileExt}`, '_optimized.jpg'),
                filePath.replace(`.${fileExt}`, '.jpg')
              );

              resolve(`/images/${fileName.replace(`.${fileExt}`, '.jpg')}`);
            } else {
              // 无 sharp 时直接使用原图
              resolve(`/images/${fileName}`);
            }
          } catch (error) {
            // 如果优化失败，保留原始文件
            resolve(`/images/${fileName}`);
          }
        });

        writer.on('error', (error) => {
          logger.error('图片保存失败:', error);
          resolve(null);
        });
      });

    } catch (error) {
      logger.error(`图片下载失败 (${picUrl}):`, error.message);
      return null;
    }
  }

  /**
   * 解析价格字符串为数字
   * @param {string} priceStr - 价格字符串
   * @returns {number} - 价格数字
   */
  parsePrice(priceStr) {
    try {
      const priceClean = String(priceStr).replace(/[^\d.]/g, '');
      const price = parseFloat(priceClean);
      return isNaN(price) ? 0 : price;
    } catch {
      return 0;
    }
  }

  /**
   * 检查价格是否在指定范围内
   * @param {string} priceStr - 价格字符串
   * @param {number} minPrice - 最低价格
   * @param {number} maxPrice - 最高价格
   * @returns {boolean} - 是否在范围内
   */
  isPriceInRange(priceStr, minPrice = 0, maxPrice = 999999) {
    try {
      const price = this.parsePrice(priceStr);
      return price >= minPrice && price <= maxPrice;
    } catch {
      return true;
    }
  }

  /**
   * 批量搜索商品（支持多页）
   * @param {object} params - 搜索参数
   * @returns {object} - 搜索结果
   */
  async searchProducts(params) {
    const {
      keyword,
      pages = 1,
      cookie,
      minPrice = 0,
      maxPrice = 999999,
      sortValue = "gmtCreate"
    } = params;

    const results = [];
    const errors = [];
    let totalChecked = 0;

    try {
      for (let page = 1; page <= pages; page++) {
        logger.info(`开始搜索第${page}页: ${keyword}`);

        const products = await this.fetchProducts(keyword, page, cookie);

        if (products?.error) {
          errors.push({
            page,
            error: products.error,
            message: products.message
          });
          break; // 如果token过期，停止后续搜索
        }

        if (products && Array.isArray(products)) {
          totalChecked += products.length;

          for (const product of products) {
            const parsed = this.parseProduct(product);
            if (parsed) {
              // 价格过滤
              if (this.isPriceInRange(parsed.price, minPrice, maxPrice)) {
                // 添加搜索来源信息
                parsed.sourceKeyword = keyword;
                parsed.sourcePage = page;
                results.push(parsed);
              }
            }
          }

          logger.info(`第${page}页完成，获取 ${products.length} 个商品，筛选后 ${results.length} 个`);
        } else {
          errors.push({
            page,
            error: 'NO_DATA',
            message: '该页面没有数据或请求失败'
          });
        }

        // 页面间延迟
        if (page < pages) {
          await new Promise(resolve => setTimeout(resolve, this.REQUEST_DELAY));
        }
      }

      return {
        success: true,
        keyword,
        totalPages: pages,
        totalChecked,
        totalResults: results.length,
        results,
        errors
      };

    } catch (error) {
      logger.error('搜索商品时发生错误:', error);
      return {
        success: false,
        error: error.message,
        keyword,
        totalPages: pages,
        totalChecked,
        totalResults: results.length,
        results,
        errors
      };
    }
  }
}

module.exports = XianyuService;
