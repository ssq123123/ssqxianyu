const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * 加密工具类
 */
class CryptoUtil {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
    this.saltRounds = 12;
  }

  /**
   * 生成随机密钥
   * @param {number} length - 密钥长度
   * @returns {string} - 十六进制密钥字符串
   */
  generateKey(length = this.keyLength) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * 生成随机IV
   * @returns {Buffer} - IV缓冲区
   */
  generateIV() {
    return crypto.randomBytes(this.ivLength);
  }

  /**
   * 从密码派生密钥
   * @param {string} password - 密码
   * @param {string} salt - 盐值
   * @returns {Buffer} - 派生的密钥
   */
  deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, this.keyLength, 'sha512');
  }

  /**
   * AES-256-GCM 加密
   * @param {string} text - 要加密的文本
   * @param {string} password - 密码
   * @returns {object} - 加密结果
   */
  encrypt(text, password) {
    try {
      const salt = crypto.randomBytes(16);
      const key = this.deriveKey(password, salt);
      const iv = this.generateIV();
      
      const cipher = crypto.createCipher(this.algorithm, key);
      cipher.setAAD(salt);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      throw new Error(`加密失败: ${error.message}`);
    }
  }

  /**
   * AES-256-GCM 解密
   * @param {object} encryptedData - 加密数据
   * @param {string} password - 密码
   * @returns {string} - 解密后的文本
   */
  decrypt(encryptedData, password) {
    try {
      const { encrypted, salt, iv, authTag } = encryptedData;
      const key = this.deriveKey(password, Buffer.from(salt, 'hex'));
      
      const decipher = crypto.createDecipher(this.algorithm, key);
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      decipher.setAAD(Buffer.from(salt, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`解密失败: ${error.message}`);
    }
  }

  /**
   * 简单字符串加密（用于Cookie等敏感信息）
   * @param {string} text - 要加密的文本
   * @returns {string} - 加密后的字符串
   */
  encryptSimple(text) {
    try {
      const key = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipher('aes-256-cbc', key);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      throw new Error(`简单加密失败: ${error.message}`);
    }
  }

  /**
   * 简单字符串解密
   * @param {string} encryptedText - 加密的文本
   * @returns {string} - 解密后的文本
   */
  decryptSimple(encryptedText) {
    try {
      const key = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
      const parts = encryptedText.split(':');
      
      if (parts.length !== 2) {
        throw new Error('无效的加密格式');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`简单解密失败: ${error.message}`);
    }
  }

  /**
   * 生成MD5哈希
   * @param {string} text - 输入文本
   * @returns {string} - MD5哈希值
   */
  md5(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * 生成SHA256哈希
   * @param {string} text - 输入文本
   * @returns {string} - SHA256哈希值
   */
  sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * 生成SHA512哈希
   * @param {string} text - 输入文本
   * @returns {string} - SHA512哈希值
   */
  sha512(text) {
    return crypto.createHash('sha512').update(text).digest('hex');
  }

  /**
   * 使用bcrypt加密密码
   * @param {string} password - 明文密码
   * @returns {Promise<string>} - 加密后的密码
   */
  async hashPassword(password) {
    try {
      return await bcrypt.hash(password, this.saltRounds);
    } catch (error) {
      throw new Error(`密码加密失败: ${error.message}`);
    }
  }

  /**
   * 验证密码
   * @param {string} password - 明文密码
   * @param {string} hashedPassword - 加密后的密码
   * @returns {Promise<boolean>} - 验证结果
   */
  async verifyPassword(password, hashedPassword) {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      throw new Error(`密码验证失败: ${error.message}`);
    }
  }

  /**
   * 生成随机字符串
   * @param {number} length - 字符串长度
   * @param {string} charset - 字符集
   * @returns {string} - 随机字符串
   */
  generateRandomString(length = 32, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    let result = '';
    const charsetLength = charset.length;
    
    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charsetLength);
      result += charset[randomIndex];
    }
    
    return result;
  }

  /**
   * 生成UUID
   * @returns {string} - UUID字符串
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * 生成安全的随机token
   * @param {number} length - token长度（字节数）
   * @returns {string} - 十六进制token字符串
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * HMAC签名
   * @param {string} data - 要签名的数据
   * @param {string} secret - 密钥
   * @param {string} algorithm - 算法（默认sha256）
   * @returns {string} - 签名结果
   */
  hmacSign(data, secret, algorithm = 'sha256') {
    return crypto.createHmac(algorithm, secret).update(data).digest('hex');
  }

  /**
   * 验证HMAC签名
   * @param {string} data - 原始数据
   * @param {string} signature - 签名
   * @param {string} secret - 密钥
   * @param {string} algorithm - 算法
   * @returns {boolean} - 验证结果
   */
  hmacVerify(data, signature, secret, algorithm = 'sha256') {
    const expectedSignature = this.hmacSign(data, secret, algorithm);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * 计算文件哈希
   * @param {string} filePath - 文件路径
   * @param {string} algorithm - 哈希算法
   * @returns {Promise<string>} - 文件哈希值
   */
  async calculateFileHash(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
      const fs = require('fs');
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 生成闲鱼API签名（从Python代码移植）
   * @param {string} token - API token
   * @param {number} timestamp - 时间戳
   * @param {string} appKey - 应用密钥
   * @param {string} requestData - 请求数据
   * @returns {string} - MD5签名
   */
  generateXianyuSign(token, timestamp, appKey, requestData) {
    const signStr = `${token}&${timestamp}&${appKey}&${requestData}`;
    return this.md5(signStr);
  }

  /**
   * 验证闲鱼API签名
   * @param {object} params - 签名参数
   * @returns {boolean} - 验证结果
   */
  verifyXianyuSign(params) {
    const { token, timestamp, appKey, requestData, sign } = params;
    const expectedSign = this.generateXianyuSign(token, timestamp, appKey, requestData);
    return expectedSign === sign;
  }

  /**
   * 加密敏感配置信息
   * @param {object} config - 配置对象
   * @param {string} password - 加密密码
   * @returns {string} - 加密后的配置字符串
   */
  encryptConfig(config, password) {
    const configStr = JSON.stringify(config);
    const encrypted = this.encrypt(configStr, password);
    return Buffer.from(JSON.stringify(encrypted)).toString('base64');
  }

  /**
   * 解密配置信息
   * @param {string} encryptedConfig - 加密的配置字符串
   * @param {string} password - 解密密码
   * @returns {object} - 解密后的配置对象
   */
  decryptConfig(encryptedConfig, password) {
    const encryptedData = JSON.parse(Buffer.from(encryptedConfig, 'base64').toString());
    const decryptedStr = this.decrypt(encryptedData, password);
    return JSON.parse(decryptedStr);
  }
}

// 创建单例实例
const cryptoUtil = new CryptoUtil();

// 导出实例和类
module.exports = cryptoUtil;
module.exports.CryptoUtil = CryptoUtil;
