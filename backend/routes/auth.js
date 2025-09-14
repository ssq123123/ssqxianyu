const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../models/User');
const cryptoUtil = require('../utils/crypto');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 微信小程序登录
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { code, userInfo } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: '缺少登录凭证'
      });
    }

    // 调用微信API获取openid
    let wechatResponse;
    try {
      wechatResponse = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: process.env.WECHAT_APP_ID,
          secret: process.env.WECHAT_APP_SECRET,
          js_code: code,
          grant_type: 'authorization_code'
        },
        timeout: 10000
      });
    } catch (wxErr) {
      const errData = wxErr.response?.data;
      logger.api.error(req, wxErr);
      return res.status(502).json({
        success: false,
        message: `微信登录失败: ${errData?.errmsg || wxErr.message}`,
        code: errData?.errcode
      });
    }

    const { openid, unionid, errcode, errmsg } = wechatResponse.data;

    if (errcode) {
      logger.api.auth(null, 'wechat_login_failed', false, errmsg);
      return res.status(400).json({
        success: false,
        message: `微信登录失败: ${errmsg}`,
        code: errcode
      });
    }

    if (!openid) {
      logger.api.auth(null, 'no_openid', false);
      return res.status(400).json({
        success: false,
        message: '获取用户信息失败'
      });
    }

    // 兼容前端字段（nickName -> nickname）
    const normalizedUserInfo = {
      nickname: userInfo?.nickname || userInfo?.nickName,
      avatarUrl: userInfo?.avatarUrl,
      unionid
    };

    // 查找或创建用户
    const user = await User.findOrCreateByOpenid(openid, normalizedUserInfo);

    // 生成JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        openid: user.openid,
        type: 'access'
      },
      process.env.JWT_SECRET || 'default-secret-change-in-production',
      { expiresIn: '30d' }
    );

    // 生成刷新token
    const refreshToken = jwt.sign(
      {
        userId: user._id,
        openid: user.openid,
        type: 'refresh'
      },
      process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
      { expiresIn: '90d' }
    );

    // 记录登录日志
    logger.api.auth(user._id, 'login_success', true);

    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        refreshToken,
        user: {
          id: user._id,
          openid: user.openid,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl,
          isNewUser: user.isNewUser,
          membership: user.membership,
          stats: user.stats,
          settings: user.settings
        }
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    const status = error.response?.status || 500;
    const msg = error.response?.data?.message || error.message || '登录失败';
    res.status(status).json({ success: false, message: msg });
  }
});

/**
 * 刷新访问令牌
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: '缺少刷新令牌'
      });
    }

    // 验证刷新令牌
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'default-refresh-secret');
    
    if (decoded.type !== 'refresh') {
      return res.status(400).json({
        success: false,
        message: '无效的刷新令牌'
      });
    }

    // 查找用户
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 生成新的访问令牌
    const newToken = jwt.sign(
      {
        userId: user._id,
        openid: user.openid,
        type: 'access'
      },
      process.env.JWT_SECRET || 'default-secret-change-in-production',
      { expiresIn: '30d' }
    );

    // 更新用户活跃时间
    await user.updateActivity();

    logger.api.auth(user._id, 'token_refresh', true);

    res.json({
      success: true,
      message: '令牌刷新成功',
      data: {
        token: newToken
      }
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '刷新令牌已过期，请重新登录'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({
        success: false,
        message: '无效的刷新令牌'
      });
    }

    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '刷新令牌失败'
    });
  }
});

/**
 * 更新Cookie
 * POST /api/auth/cookie
 */
router.post('/cookie', async (req, res) => {
  try {
    const { cookie } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    if (!cookie || typeof cookie !== 'string' || cookie.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cookie不能为空'
      });
    }

    // 验证Cookie格式（检查是否包含必要的字段）
    if (!cookie.includes('_m_h5_tk=')) {
      return res.status(400).json({
        success: false,
        message: 'Cookie格式不正确，缺少必要的认证信息'
      });
    }

    // 查找用户
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 加密并保存Cookie
    const encryptedCookie = cryptoUtil.encryptSimple(cookie.trim());
    await user.updateCookie(encryptedCookie);

    logger.api.auth(userId, 'cookie_update', true);

    res.json({
      success: true,
      message: 'Cookie更新成功',
      data: {
        cookieUpdatedAt: user.cookieUpdatedAt,
        isExpired: user.isCookieExpired()
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: 'Cookie更新失败'
    });
  }
});

/**
 * 获取Cookie状态
 * GET /api/auth/cookie/status
 */
router.get('/cookie/status', async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const user = await User.findById(userId).select('+cookie');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const hasCookie = !!(user.cookie && user.cookie.trim());
    const isExpired = user.isCookieExpired();

    res.json({
      success: true,
      data: {
        hasCookie,
        isExpired,
        cookieUpdatedAt: user.cookieUpdatedAt,
        daysUntilExpire: user.cookieUpdatedAt ? 
          Math.max(0, 7 - Math.floor((Date.now() - user.cookieUpdatedAt.getTime()) / (1000 * 60 * 60 * 24))) : 
          0
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取Cookie状态失败'
    });
  }
});

/**
 * 获取用户信息
 * GET /api/auth/profile
 */
router.get('/profile', async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 更新活跃时间
    await user.updateActivity();

    res.json({
      success: true,
      data: {
        id: user._id,
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        membership: user.membership,
        stats: user.stats,
        settings: user.settings,
        status: user.status,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

/**
 * 更新用户信息
 * PUT /api/auth/profile
 */
router.put('/profile', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { nickname, avatarUrl } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 更新用户信息
    if (nickname && nickname.trim()) {
      user.nickname = nickname.trim();
    }
    if (avatarUrl && avatarUrl.trim()) {
      user.avatarUrl = avatarUrl.trim();
    }

    await user.save();

    logger.api.auth(userId, 'profile_update', true);

    res.json({
      success: true,
      message: '用户信息更新成功',
      data: {
        id: user._id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '更新用户信息失败'
    });
  }
});

/**
 * 更新用户设置
 * PUT /api/auth/settings
 */
router.put('/settings', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { settings } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        message: '设置参数无效'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 合并设置
    if (settings.notifications) {
      user.settings.notifications = { ...user.settings.notifications, ...settings.notifications };
    }
    if (settings.defaultMonitor) {
      user.settings.defaultMonitor = { ...user.settings.defaultMonitor, ...settings.defaultMonitor };
    }

    await user.save();

    logger.api.auth(userId, 'settings_update', true);

    res.json({
      success: true,
      message: '设置更新成功',
      data: {
        settings: user.settings
      }
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '更新设置失败'
    });
  }
});

/**
 * 获取用户统计信息
 * GET /api/auth/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 获取详细统计信息
    const MonitorTask = require('../models/MonitorTask');
    const Product = require('../models/Product');

    const [taskStats, productStats] = await Promise.all([
      MonitorTask.getUserStats(userId),
      Product.aggregate([
        { $match: { userId: user._id } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalLowPriceAlerts: { $sum: { $cond: ['$isLowPriceAlert', 1, 0] } },
            avgPrice: { $avg: '$price' },
            recentProducts: {
              $sum: {
                $cond: [
                  { $gte: ['$foundAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                  1, 0
                ]
              }
            }
          }
        }
      ])
    ]);

    const detailedStats = {
      ...user.stats.toObject(),
      tasks: taskStats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          totalProducts: stat.totalProducts,
          totalAlerts: stat.totalAlerts
        };
        return acc;
      }, {}),
      products: productStats.length > 0 ? {
        total: productStats[0].totalProducts,
        lowPriceAlerts: productStats[0].totalLowPriceAlerts,
        avgPrice: Math.round(productStats[0].avgPrice * 100) / 100,
        recentWeek: productStats[0].recentProducts
      } : {
        total: 0,
        lowPriceAlerts: 0,
        avgPrice: 0,
        recentWeek: 0
      }
    };

    res.json({
      success: true,
      data: detailedStats
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '获取统计信息失败'
    });
  }
});

/**
 * 注销登录
 * POST /api/auth/logout
 */
router.post('/logout', async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (userId) {
      logger.api.auth(userId, 'logout', true);
    }

    res.json({
      success: true,
      message: '注销成功'
    });

  } catch (error) {
    logger.api.error(req, error);
    res.status(500).json({
      success: false,
      message: '注销失败'
    });
  }
});

module.exports = router;
