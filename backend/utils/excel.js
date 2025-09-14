const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
let sharp;
try {
  // 可选依赖：如果安装失败则优雅降级
  sharp = require('sharp');
} catch (e) {
  sharp = null;
}
const logger = require('./logger');

/**
 * Excel处理工具类
 */
class ExcelUtil {
  constructor() {
    this.exportPath = path.join(__dirname, '../public/exports');
    
    // 确保导出目录存在
    if (!fs.existsSync(this.exportPath)) {
      fs.mkdirSync(this.exportPath, { recursive: true });
    }
  }

  /**
   * 创建商品导出Excel文件
   * @param {Array} products - 商品数据数组
   * @param {object} options - 导出选项
   * @returns {object} - 导出结果
   */
  async createProductExcel(products, options = {}) {
    try {
      const {
        fileName = `xianyu_products_${Date.now()}.xlsx`,
        includeImages = true,
        includeStats = true,
        sheetName = '闲鱼商品数据',
        isLowPriceAlert = false
      } = options;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(sheetName);

      // 设置工作表属性
      worksheet.properties.defaultRowHeight = includeImages ? 80 : 20;
      
      // 定义表头
      const headers = [
        { header: '发现时间', key: 'foundAt', width: 20 },
        { header: '类型', key: 'type', width: 12 },
        { header: '关键词', key: 'keyword', width: 15 },
        { header: '商品标题', key: 'title', width: 50 },
        { header: '价格', key: 'price', width: 10 },
        { header: '卖家', key: 'userName', width: 15 },
        { header: '地区', key: 'area', width: 15 },
        { header: '商品链接', key: 'url', width: 30 }
      ];

      if (includeImages) {
        headers.push({ header: '商品图片', key: 'image', width: 20 });
      }

      if (isLowPriceAlert) {
        headers.push({ header: '预警价格', key: 'alertPrice', width: 12 });
      }

      // 设置表头
      worksheet.columns = headers;

      // 设置表头样式
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '4472C4' }
      };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

      // 添加数据行
      let rowIndex = 2;
      for (const product of products) {
        const rowData = {
          foundAt: new Date(product.foundAt).toLocaleString('zh-CN'),
          type: product.isLowPriceAlert ? '🚨低价预警' : '📦常规发现',
          keyword: product.sourceKeyword,
          title: product.title || product.description,
          price: `¥${product.price}`,
          userName: product.userName,
          area: product.area,
          url: product.url
        };

        if (isLowPriceAlert && product.alertPrice) {
          rowData.alertPrice = `¥${product.alertPrice}`;
        }

        const row = worksheet.addRow(rowData);
        
        // 设置行样式
        row.alignment = { vertical: 'middle', wrapText: true };
        
        // 价格单元格样式
        const priceCell = row.getCell('price');
        priceCell.font = { bold: true, color: { argb: product.isLowPriceAlert ? 'FF0000' : '000000' } };
        
        // 链接样式
        const urlCell = row.getCell('url');
        urlCell.font = { color: { argb: '0563C1' }, underline: true };

        // 处理图片
        if (includeImages && product.picUrl && product.picUrl !== '无图片链接') {
          try {
            const imagePath = await this.downloadAndProcessImage(product.picUrl, product.itemId);
            if (imagePath) {
              const imageId = workbook.addImage({
                filename: imagePath,
                extension: 'jpeg'
              });
              
              worksheet.addImage(imageId, {
                tl: { col: headers.findIndex(h => h.key === 'image'), row: rowIndex - 1 },
                ext: { width: 100, height: 75 }
              });
              
              // 设置图片行高
              row.height = 80;
            }
          } catch (imageError) {
            logger.warn(`图片处理失败 ${product.itemId}:`, imageError.message);
          }
        }

        rowIndex++;
      }

      // 设置筛选器
      worksheet.autoFilter = `A1:${String.fromCharCode(64 + headers.length)}1`;

      // 添加统计信息工作表
      if (includeStats && products.length > 0) {
        await this.addStatsWorksheet(workbook, products, isLowPriceAlert);
      }

      // 保存文件
      const filePath = path.join(this.exportPath, fileName);
      await workbook.xlsx.writeFile(filePath);

      logger.info(`Excel文件生成成功: ${fileName}, 包含 ${products.length} 条记录`);

      return {
        success: true,
        fileName,
        filePath,
        downloadUrl: `/exports/${fileName}`,
        recordCount: products.length,
        fileSize: this.getFileSize(filePath)
      };

    } catch (error) {
      logger.error('生成Excel文件失败:', error);
      throw error;
    }
  }

  /**
   * 添加统计信息工作表
   * @param {ExcelJS.Workbook} workbook - 工作簿
   * @param {Array} products - 商品数据
   * @param {boolean} isLowPriceAlert - 是否为低价预警
   */
  async addStatsWorksheet(workbook, products, isLowPriceAlert = false) {
    const statsSheet = workbook.addWorksheet('统计信息');
    
    // 基本统计
    const stats = this.calculateProductStats(products);
    
    // 设置统计表头
    statsSheet.columns = [
      { header: '统计项目', key: 'item', width: 20 },
      { header: '数值', key: 'value', width: 15 },
      { header: '说明', key: 'description', width: 30 }
    ];

    // 设置表头样式
    const headerRow = statsSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E7E6E6' }
    };

    // 添加统计数据
    const statsData = [
      { item: '商品总数', value: stats.totalProducts, description: '本次导出的商品总数量' },
      { item: '平均价格', value: `¥${stats.avgPrice}`, description: '所有商品的平均价格' },
      { item: '最低价格', value: `¥${stats.minPrice}`, description: '价格最低的商品' },
      { item: '最高价格', value: `¥${stats.maxPrice}`, description: '价格最高的商品' },
      { item: '关键词数量', value: stats.keywordCount, description: '涉及的搜索关键词数量' },
      { item: '卖家数量', value: stats.sellerCount, description: '不同卖家的数量' }
    ];

    if (isLowPriceAlert) {
      statsData.push(
        { item: '预警商品数', value: stats.alertProductCount, description: '触发低价预警的商品数量' },
        { item: '平均预警价格', value: `¥${stats.avgAlertPrice}`, description: '预警商品的平均价格' }
      );
    }

    statsData.forEach(data => {
      statsSheet.addRow(data);
    });

    // 添加关键词分布图表数据
    if (stats.keywordDistribution.length > 0) {
      statsSheet.addRow([]); // 空行
      statsSheet.addRow({ item: '关键词分布', value: '', description: '' });
      
      const keywordHeaderRow = statsSheet.addRow(['关键词', '商品数量', '占比']);
      keywordHeaderRow.font = { bold: true };
      
      stats.keywordDistribution.forEach(kw => {
        statsSheet.addRow([
          kw.keyword,
          kw.count,
          `${kw.percentage}%`
        ]);
      });
    }

    // 添加价格区间分布
    if (stats.priceDistribution.length > 0) {
      statsSheet.addRow([]); // 空行
      statsSheet.addRow({ item: '价格区间分布', value: '', description: '' });
      
      const priceHeaderRow = statsSheet.addRow(['价格区间', '商品数量', '占比']);
      priceHeaderRow.font = { bold: true };
      
      stats.priceDistribution.forEach(price => {
        statsSheet.addRow([
          price.range,
          price.count,
          `${price.percentage}%`
        ]);
      });
    }
  }

  /**
   * 计算商品统计信息
   * @param {Array} products - 商品数据
   * @returns {object} - 统计结果
   */
  calculateProductStats(products) {
    const totalProducts = products.length;
    const prices = products.map(p => p.price).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices).toFixed(2) : 0;

    // 关键词统计
    const keywordMap = {};
    products.forEach(p => {
      const keyword = p.sourceKeyword || '未知';
      keywordMap[keyword] = (keywordMap[keyword] || 0) + 1;
    });

    const keywordDistribution = Object.entries(keywordMap)
      .map(([keyword, count]) => ({
        keyword,
        count,
        percentage: ((count / totalProducts) * 100).toFixed(1)
      }))
      .sort((a, b) => b.count - a.count);

    // 卖家统计
    const sellerSet = new Set(products.map(p => p.userName));
    const sellerCount = sellerSet.size;

    // 价格区间分布
    const priceRanges = {
      '0-50': 0,
      '50-100': 0,
      '100-200': 0,
      '200-500': 0,
      '500-1000': 0,
      '1000+': 0
    };

    prices.forEach(price => {
      if (price < 50) priceRanges['0-50']++;
      else if (price < 100) priceRanges['50-100']++;
      else if (price < 200) priceRanges['100-200']++;
      else if (price < 500) priceRanges['200-500']++;
      else if (price < 1000) priceRanges['500-1000']++;
      else priceRanges['1000+']++;
    });

    const priceDistribution = Object.entries(priceRanges)
      .map(([range, count]) => ({
        range,
        count,
        percentage: ((count / totalProducts) * 100).toFixed(1)
      }))
      .filter(item => item.count > 0);

    // 预警商品统计
    const alertProducts = products.filter(p => p.isLowPriceAlert);
    const alertProductCount = alertProducts.length;
    const alertPrices = alertProducts.map(p => p.price).filter(p => p > 0);
    const avgAlertPrice = alertPrices.length > 0 ? (alertPrices.reduce((a, b) => a + b, 0) / alertPrices.length).toFixed(2) : 0;

    return {
      totalProducts,
      avgPrice,
      minPrice,
      maxPrice,
      keywordCount: keywordDistribution.length,
      sellerCount,
      keywordDistribution,
      priceDistribution,
      alertProductCount,
      avgAlertPrice
    };
  }

  /**
   * 下载并处理图片
   * @param {string} imageUrl - 图片URL
   * @param {string} itemId - 商品ID
   * @returns {string|null} - 本地图片路径
   */
  async downloadAndProcessImage(imageUrl, itemId) {
    try {
      const axios = require('axios');
      const imagePath = path.join(this.exportPath, 'images');
      
      if (!fs.existsSync(imagePath)) {
        fs.mkdirSync(imagePath, { recursive: true });
      }

      // 处理图片URL
      let processedUrl = imageUrl;
      if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
        processedUrl = processedUrl.startsWith('//') ? `http:${processedUrl}` : `https://${processedUrl}`;
      }

      const fileName = `${itemId}.jpg`;
      const filePath = path.join(imagePath, fileName);

      // 如果文件已存在，直接返回
      if (fs.existsSync(filePath)) {
        return filePath;
      }

      // 下载图片
      const response = await axios({
        method: 'GET',
        url: processedUrl,
        responseType: 'stream',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // 保存原始图片
      const tempPath = path.join(imagePath, `temp_${itemId}`);
      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          try {
            if (sharp) {
              await sharp(tempPath)
                .resize(150, 150, {
                  fit: 'inside',
                  withoutEnlargement: true
                })
                .jpeg({ quality: 80 })
                .toFile(filePath);
            } else {
              // 无 sharp 时直接使用原图
              fs.renameSync(tempPath, filePath);
            }

            // 删除临时文件
            fs.unlinkSync(tempPath);
            resolve(filePath);
          } catch (error) {
            // 如果处理失败，使用原始文件
            fs.renameSync(tempPath, filePath);
            resolve(filePath);
          }
        });

        writer.on('error', () => {
          reject(new Error('图片下载失败'));
        });
      });

    } catch (error) {
      logger.warn(`图片处理失败 ${itemId}:`, error.message);
      return null;
    }
  }

  /**
   * 创建监控任务报告
   * @param {object} task - 监控任务
   * @param {Array} products - 商品数据
   * @returns {object} - 导出结果
   */
  async createTaskReport(task, products) {
    try {
      const fileName = `task_report_${task._id}_${Date.now()}.xlsx`;
      const workbook = new ExcelJS.Workbook();

      // 任务概览工作表
      const overviewSheet = workbook.addWorksheet('任务概览');
      this.addTaskOverview(overviewSheet, task);

      // 商品数据工作表
      const productsSheet = workbook.addWorksheet('发现的商品');
      await this.addProductsToSheet(productsSheet, products, true);

      // 统计分析工作表
      if (products.length > 0) {
        await this.addStatsWorksheet(workbook, products);
      }

      // 保存文件
      const filePath = path.join(this.exportPath, fileName);
      await workbook.xlsx.writeFile(filePath);

      return {
        success: true,
        fileName,
        filePath,
        downloadUrl: `/exports/${fileName}`,
        recordCount: products.length,
        fileSize: this.getFileSize(filePath)
      };

    } catch (error) {
      logger.error('生成任务报告失败:', error);
      throw error;
    }
  }

  /**
   * 添加任务概览信息
   * @param {ExcelJS.Worksheet} worksheet - 工作表
   * @param {object} task - 任务数据
   */
  addTaskOverview(worksheet, task) {
    worksheet.columns = [
      { header: '项目', key: 'item', width: 20 },
      { header: '内容', key: 'content', width: 50 }
    ];

    const overviewData = [
      { item: '任务名称', content: task.name },
      { item: '任务描述', content: task.description || '无' },
      { item: '监控关键词', content: task.keywords.filter(k => k.enabled).map(k => k.keyword).join(', ') },
      { item: '监控间隔', content: `${task.interval} 秒` },
      { item: '监控页数', content: `${task.monitorPages} 页` },
      { item: '价格范围', content: `¥${task.minPrice} - ¥${task.maxPrice}` },
      { item: '低价预警', content: task.enableAlert ? `启用 (¥${task.alertPrice})` : '未启用' },
      { item: '任务状态', content: task.status },
      { item: '创建时间', content: new Date(task.createdAt).toLocaleString('zh-CN') },
      { item: '开始时间', content: task.startTime ? new Date(task.startTime).toLocaleString('zh-CN') : '未开始' },
      { item: '停止时间', content: task.stopTime ? new Date(task.stopTime).toLocaleString('zh-CN') : '未停止' },
      { item: '监控轮次', content: task.stats.totalRounds },
      { item: '检查商品数', content: task.stats.totalProductsChecked },
      { item: '发现商品数', content: task.stats.totalNewProducts },
      { item: '低价预警数', content: task.stats.totalLowPriceAlerts },
      { item: '成功率', content: `${task.successRate}%` }
    ];

    overviewData.forEach(data => {
      worksheet.addRow(data);
    });

    // 设置样式
    worksheet.getRow(1).font = { bold: true };
    worksheet.getColumn('A').font = { bold: true };
  }

  /**
   * 获取文件大小
   * @param {string} filePath - 文件路径
   * @returns {string} - 格式化的文件大小
   */
  getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const fileSizeInBytes = stats.size;
      
      if (fileSizeInBytes < 1024) {
        return fileSizeInBytes + ' B';
      } else if (fileSizeInBytes < 1024 * 1024) {
        return (fileSizeInBytes / 1024).toFixed(2) + ' KB';
      } else {
        return (fileSizeInBytes / (1024 * 1024)).toFixed(2) + ' MB';
      }
    } catch (error) {
      return '未知';
    }
  }

  /**
   * 清理过期的导出文件
   * @param {number} maxAge - 最大保留时间（小时）
   */
  cleanupExpiredExports(maxAge = 24) {
    try {
      const files = fs.readdirSync(this.exportPath);
      const now = Date.now();
      const maxAgeMs = maxAge * 60 * 60 * 1000;

      files.forEach(file => {
        const filePath = path.join(this.exportPath, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAgeMs) {
          fs.unlinkSync(filePath);
          logger.info(`清理过期导出文件: ${file}`);
        }
      });
    } catch (error) {
      logger.error('清理导出文件失败:', error);
    }
  }

  /**
   * 批量导出多个任务的数据
   * @param {Array} tasks - 任务列表
   * @returns {object} - 导出结果
   */
  async batchExportTasks(tasks) {
    try {
      const fileName = `batch_export_${Date.now()}.xlsx`;
      const workbook = new ExcelJS.Workbook();

      for (const task of tasks) {
        const products = await require('../models/Product').find({ taskId: task._id });
        const sheetName = `${task.name.substring(0, 20)}_${task._id.toString().substring(0, 8)}`;
        
        const worksheet = workbook.addWorksheet(sheetName);
        await this.addProductsToSheet(worksheet, products, true);
      }

      const filePath = path.join(this.exportPath, fileName);
      await workbook.xlsx.writeFile(filePath);

      return {
        success: true,
        fileName,
        filePath,
        downloadUrl: `/exports/${fileName}`,
        taskCount: tasks.length,
        fileSize: this.getFileSize(filePath)
      };

    } catch (error) {
      logger.error('批量导出失败:', error);
      throw error;
    }
  }
}

module.exports = new ExcelUtil();
