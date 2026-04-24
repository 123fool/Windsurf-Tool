const path = require('path');
const Module = require('module');
const axios = require('axios');

// 在打包环境中，从解压目录加载模块
// 解决 ESM 动态导入在 asar 中的问题
const isPackaged = __dirname.includes('app.asar');
let connect;

if (isPackaged) {
  try {
    // 计算解压模块的路径（使用绝对路径）
    // __dirname 在 asar 中是 app.asar/src，需要替换为 app.asar.unpacked
    const asarPath = __dirname.replace('app.asar', 'app.asar.unpacked');
    const unpackedNodeModules = path.join(asarPath, '..', 'node_modules');
    
    console.log('[调试] __dirname:', __dirname);
    console.log('[调试] unpackedNodeModules:', unpackedNodeModules);
    
    // 关键修复：将 unpacked node_modules 添加到 Node.js 模块搜索路径
    // 这样所有的 require() 调用都会优先从 unpacked 目录查找
    if (!module.paths.includes(unpackedNodeModules)) {
      module.paths.unshift(unpackedNodeModules);
      console.log('[调试] 已添加 unpacked 路径到模块搜索路径');
    }
    
    // 修改全局模块解析，确保所有模块都从 unpacked 加载
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, isMain) {
      // 对于所有 node_modules 中的模块，优先从 unpacked 目录查找
      if (!request.startsWith('.') && !request.startsWith('/') && !path.isAbsolute(request)) {
        try {
          // 尝试从 unpacked 目录解析
          const unpackedPath = path.join(unpackedNodeModules, request);
          if (require('fs').existsSync(unpackedPath)) {
            return originalResolveFilename.call(this, unpackedPath, parent, isMain);
          }
        } catch (e) {
          // 继续使用原始解析
        }
      }
      return originalResolveFilename.call(this, request, parent, isMain);
    };
    
    // 直接使用绝对路径加载 puppeteer-real-browser
    const puppeteerRealBrowserPath = path.join(unpackedNodeModules, 'puppeteer-real-browser');
    
    const prb = require(puppeteerRealBrowserPath);
    connect = prb.connect;
    console.log('从解压目录加载 puppeteer-real-browser 成功');
    console.log('[调试] 加载路径:', puppeteerRealBrowserPath);
  } catch (e) {
    console.error('从解压目录加载失败:', e.message);
    console.error('[调试] 错误堆栈:', e.stack);
    // 回退到默认路径
    connect = require('puppeteer-real-browser').connect;
  }
} else {
  connect = require('puppeteer-real-browser').connect;
}
const { app } = require('electron'); // 导入electron的app模块
const os = require('os'); // 导入os模块
const crypto = require('crypto'); // 用于生成CDN Token
const CONSTANTS = require('../js/constants'); // 导入全局常量配置

// 实例计数器（用于生成唯一的用户数据目录）
let instanceCounter = 0;

class RegistrationBot {
  constructor(config, saveAccountCallback = null) {
    this.config = config;
    // 实例唯一ID（用于并发时区分不同浏览器实例）
    this.instanceId = ++instanceCounter;
    // 自定义域名邮箱列表
    this.emailDomains = config.emailDomains || ['example.com'];
    // 邮箱编号计数器(1-999)
    this.emailCounter = 1;
    // 取消标志
    this.isCancelled = false;
    // Chrome 路径缓存
    this.chromePathCache = null;
    // 保存账号的回调函数（由主进程传入）
    this.saveAccountCallback = saveAccountCallback;
  }

  /**
   * 生成注册URL
   * @returns {string} - 注册URL
   */
  generateRegistrationUrl() {
    return 'https://windsurf.com/account/register';
  }

  /**
   * 生成域名邮箱
   * 格式: 时间戳(后3位) + 随机字母数字(4位) + 计数器(1位) = 8位
   */
  async generateTempEmail() {
    // 使用时间戳后3位（确保短期内唯一）
    const timestamp = Date.now().toString().slice(-3);
    
    // 生成随机字母数字组合(4位)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < 4; i++) {
      randomStr += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // 添加计数器作为额外保护（1位）
    const counter = (this.emailCounter % 10).toString();
    
    // 组合用户名: 时间戳 + 随机字符串 + 计数器
    // 例如: 922k3x91@domain.com (8位)
    const username = `${timestamp}${randomStr}${counter}`;
    
    // 随机选择配置的域名
    const randomIndex = Math.floor(Math.random() * this.emailDomains.length);
    const domain = this.emailDomains[randomIndex];
    
    // 递增计数器
    this.emailCounter++;
    if (this.emailCounter > 9) {
      this.emailCounter = 1;
    }
    
    return `${username}@${domain}`;
  }

  /**
   * 获取邮箱验证码（使用本地EmailReceiver）
   * 支持重试机制：最多重试2次，每次间隔20秒
   */
  async getVerificationCode(email, maxWaitTime = 90000) {
    // 检查取消标志
    if (this.isCancelled) {
      throw new Error('注册已取消');
    }
    
    const emailConfig = this.config.emailConfig;
    
    if (!emailConfig) {
      throw new Error('未配置邮箱 IMAP 信息，请先在"配置"页面正确填写 QQ 邮箱账号和授权码');
    }
    
    const EmailReceiver = require('./emailReceiver');
    // 将批量注册的日志回调传入 EmailReceiver，便于在前端实时看到详细 IMAP 日志
    const receiver = new EmailReceiver(emailConfig, this.logCallback);
    
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 20000; // 20秒
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // 每次重试前检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      try {
        if (this.logCallback) {
          this.logCallback(`第 ${attempt} 次尝试获取验证码（QQ 邮箱 IMAP）...`);
        }
        console.log(`[尝试 ${attempt}/${MAX_RETRIES}] 等待 ${email} 的验证码邮件...`);
        
        const code = await receiver.getVerificationCode(email, maxWaitTime);
        
        if (code) {
          if (this.logCallback) {
            this.logCallback(`成功获取验证码: ${code}`);
          }
          return code;
        }
      } catch (error) {
        console.error(`[尝试 ${attempt}/${MAX_RETRIES}] 获取验证码失败:`, error.message);
        if (this.logCallback) {
          this.logCallback(`获取验证码失败（第 ${attempt}/${MAX_RETRIES} 次）：${error.message}`);
        }
        
        if (attempt < MAX_RETRIES) {
          if (this.logCallback) {
            this.logCallback(`第 ${attempt} 次获取失败，${RETRY_DELAY/1000} 秒后将重试...`);
          }
          console.log(`等待 ${RETRY_DELAY/1000} 秒后重试...`);
          await this.sleep(RETRY_DELAY);
        } else {
          if (this.logCallback) {
            this.logCallback(`已重试 ${MAX_RETRIES} 次，仍未获取到验证码，请检查 QQ 邮箱 IMAP 配置、授权码和邮件是否正常发送`);
          }
          throw new Error(`获取验证码失败，已重试 ${MAX_RETRIES} 次: ${error.message}`);
        }
      }
    }
    
    throw new Error('获取验证码失败，已达到最大重试次数');
  }


  /**
   * 生成随机密码
   * 包含大小写字母、数字和符号，长度12-16位
   */
  generateRandomPassword() {
    const length = Math.floor(Math.random() * 5) + 12; // 12-16位
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercase + lowercase + numbers + symbols;
    
    let password = '';
    
    // 确保至少包含一个大写字母
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    // 确保至少包含一个小写字母
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    // 确保至少包含一个数字
    password += numbers[Math.floor(Math.random() * numbers.length)];
    // 确保至少包含一个符号
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    // 填充剩余长度
    for (let i = password.length; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // 打乱密码字符顺序
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * 生成随机英文名
   */
  generateRandomName() {
    const firstNames = [
      'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
      'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen',
      'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth',
      'Emily', 'Ashley', 'Kimberly', 'Melissa', 'Donna', 'Michelle', 'Dorothy', 'Carol', 'Amanda', 'Betty'
    ];
    
    const lastNames = [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
      'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White',
      'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott',
      'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips'
    ];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    return { firstName, lastName };
  }

  getWorkerUrl() {
    const configuredWorkerUrl = typeof this.config.workerUrl === 'string'
      ? this.config.workerUrl.trim()
      : '';

    if (/^https?:\/\//i.test(configuredWorkerUrl)) {
      return configuredWorkerUrl.replace(/\/+$/, '');
    }

    return CONSTANTS.getWorkerUrl();
  }

  mapLoginErrorMessage(message) {
    if (!message) {
      return '登录失败，请检查账号密码';
    }

    if (message.includes('Invalid email or password')) {
      return '邮箱或密码错误，请检查登录凭据是否正确';
    }
    if (message.includes('No account found')) {
      return '账号不存在，请先确认账号是否真正注册成功';
    }
    if (message.includes('EMAIL_NOT_FOUND')) {
      return '邮箱不存在，请检查邮箱地址是否正确';
    }
    if (message.includes('INVALID_PASSWORD') || message.includes('INVALID_LOGIN_CREDENTIALS')) {
      return '邮箱或密码错误，请检查登录凭据是否正确';
    }
    if (message.includes('USER_DISABLED')) {
      return '账号已被禁用';
    }
    if (message.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
      return '尝试次数过多，请稍后再试';
    }
    if (message.includes('INVALID_EMAIL')) {
      return '邮箱格式不正确';
    }
    if (message.includes('API_KEY_HTTP_REFERRER_BLOCKED') || message.includes('API key not valid')) {
      return '中转服务配置异常，请检查 Worker 域名和 Firebase 配置';
    }

    return message;
  }

  async verifyWithAuth1Password(email, password) {
    try {
      const response = await axios.post(
        'https://windsurf.com/_devin-auth/password/login',
        {
          email,
          password
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: CONSTANTS.REQUEST_TIMEOUT
        }
      );

      if (!response.data || !response.data.token) {
        return {
          success: false,
          error: '登录失败，请检查账号密码'
        };
      }

      return { success: true };
    } catch (error) {
      const rawErrorMessage = error.response?.data?.detail || error.response?.data?.error?.message || error.response?.data?.error || error.message || '';
      return {
        success: false,
        error: this.mapLoginErrorMessage(String(rawErrorMessage))
      };
    }
  }

  async verifyWithFirebasePassword(email, password) {
    try {
      const response = await axios.post(
        `${this.getWorkerUrl()}/login`,
        {
          email,
          password,
          api_key: CONSTANTS.FIREBASE_API_KEY,
          returnSecureToken: true
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: CONSTANTS.REQUEST_TIMEOUT
        }
      );

      if (!response.data || !response.data.idToken) {
        return {
          success: false,
          error: '登录失败，请检查账号密码'
        };
      }

      return { success: true };
    } catch (error) {
      const rawErrorMessage = error.response?.data?.error?.message || error.response?.data?.error || error.message || '';
      return {
        success: false,
        error: this.mapLoginErrorMessage(String(rawErrorMessage))
      };
    }
  }

  async verifyAccountCredentials(email, password) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const auth1Result = await this.verifyWithAuth1Password(email, password);
      if (auth1Result.success) {
        return { success: true };
      }

      const firebaseResult = await this.verifyWithFirebasePassword(email, password);
      if (firebaseResult.success) {
        return { success: true };
      }

      const friendlyMessage = auth1Result.error || firebaseResult.error || '登录失败，请检查账号密码';

      if (attempt === maxAttempts) {
        return {
          success: false,
          error: friendlyMessage
        };
      }

      this.log(`账号凭据校验第 ${attempt} 次失败，准备重试: ${friendlyMessage}`);
      await this.sleep(2000);
    }

    return {
      success: false,
      error: '登录失败，请检查账号密码'
    };
  }

  /**
   * 输出日志(同时发送到前端)
   */
  log(message) {
    console.log(message);
    if (this.logCallback) {
      this.logCallback(message);
    }
  }

  /**
   * 检测Chrome浏览器路径（跨平台，带缓存）
   */
  detectChromePath() {
    // 使用缓存，避免重复检测
    if (this.chromePathCache !== null) {
      return this.chromePathCache;
    }
    
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    const platform = os.platform();
    
    let detectedPath = null;
    
    if (platform === 'win32') {
      detectedPath = this.detectChromePathWindows(fs, path, execSync);
    } else if (platform === 'darwin') {
      detectedPath = this.detectChromePathMac(fs, path);
    }
    
    // 缓存结果
    this.chromePathCache = detectedPath;
    
    if (!detectedPath) {
      this.log('未找到 Chrome 浏览器，将使用系统默认路径');
    }
    
    return detectedPath;
  }

  /**
   * Windows Chrome 检测（优化版：快速 + 全面）
   */
  detectChromePathWindows(fs, path, execSync) {
    const checkedPaths = new Set(); // 全局去重，避免重复检测
    
    // 辅助函数：验证 Chrome 路径
    const validateChrome = (chromePath) => {
      try {
        if (!chromePath || checkedPaths.has(chromePath)) {
          return false;
        }
        checkedPaths.add(chromePath);
        
        if (fs.existsSync(chromePath)) {
          const stats = fs.statSync(chromePath);
          if (stats.isFile() && stats.size > 0) {
            this.log(`找到 Chrome: ${chromePath}`);
            return true;
          }
        }
      } catch (e) {
        // 忽略错误
      }
      return false;
    };

    // ========== 方法1: WHERE 命令（最快） ==========
    try {
      const whereResult = execSync('where chrome', { 
        encoding: 'utf8', 
        timeout: 2000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      // 遍历所有返回的路径
      const chromePaths = whereResult.split('\n').map(p => p.trim()).filter(p => p);
      for (const chromePath of chromePaths) {
        if (validateChrome(chromePath)) {
          return chromePath;
        }
      }
    } catch (e) {
      // WHERE 命令失败，继续其他方法
    }

    // ========== 方法2: 注册表检测（最可靠） ==========
    const registryPaths = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'
    ];
    
    for (const regPath of registryPaths) {
      try {
        const result = execSync(`reg query "${regPath}" /ve`, { 
          encoding: 'utf8', 
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'ignore']
        });
        
        const match = result.match(/REG_SZ\s+(.+)/);
        if (match && match[1]) {
          const chromePath = match[1].trim();
          if (validateChrome(chromePath)) {
            return chromePath;
          }
        }
      } catch (e) {
        // 继续下一个注册表路径
      }
    }

    // ========== 方法3: 常见路径快速检测 ==========
    const quickPaths = [];
    
    // 用户级安装（最常见）
    if (process.env.LOCALAPPDATA) {
      quickPaths.push(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    
    // 系统级安装
    if (process.env.PROGRAMFILES) {
      quickPaths.push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    if (process.env['PROGRAMFILES(X86)']) {
      quickPaths.push(path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    
    // 快速检测常见路径
    for (const chromePath of quickPaths) {
      if (validateChrome(chromePath)) {
        return chromePath;
      }
    }

    // ========== 方法4: 多盘符扫描（兜底） ==========
    // 只扫描 C-H 盘（跳过 A/B 软盘）
    const driveLetters = ['C', 'D', 'E', 'F', 'G', 'H'];
    let needsScan = false;
    
    for (const drive of driveLetters) {
      const drivePath = `${drive}:\\`;
      
      // 快速检查盘符是否存在
      try {
        if (!fs.existsSync(drivePath)) continue;
      } catch (e) {
        continue;
      }
      
      if (!needsScan) {
        this.log('常见路径未找到，开始扫描其他磁盘...');
        needsScan = true;
      }
      
      // 常见自定义安装位置（包含 Program Files）
      const customPaths = [
        // 标准位置
        path.join(drivePath, 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        // 自定义位置
        path.join(drivePath, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Programs', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Program', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Software', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Apps', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Chrome', 'Application', 'chrome.exe'),
        path.join(drivePath, 'Tools', 'Chrome', 'Application', 'chrome.exe'),
        // Chromium 变体
        path.join(drivePath, 'Chromium', 'Application', 'chrome.exe')
      ];
      
      // 检测自定义路径
      for (const chromePath of customPaths) {
        if (validateChrome(chromePath)) {
          return chromePath;
        }
      }
    }
    
    this.log(' 未找到 Chrome，将使用系统默认路径');
    return null;
  }

  /**
   * Mac Chrome 检测（优化版）
   */
  detectChromePathMac(fs, path) {
    const { execSync } = require('child_process');
    const checkedPaths = new Set();
    
    // 辅助函数：验证 Chrome 路径
    const validateChrome = (chromePath) => {
      try {
        if (!chromePath || checkedPaths.has(chromePath)) {
          return false;
        }
        checkedPaths.add(chromePath);
        
        if (fs.existsSync(chromePath)) {
          const stats = fs.statSync(chromePath);
          if (stats.isFile() && stats.size > 0) {
            this.log(`找到 Chrome: ${chromePath}`);
            return true;
          }
        }
      } catch (e) {
        // 忽略错误
      }
      return false;
    };

    // ========== 方法1: which 命令（最快） ==========
    try {
      const whichResult = execSync('which chrome', { 
        encoding: 'utf8', 
        timeout: 2000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      const chromePath = whichResult.trim();
      if (validateChrome(chromePath)) {
        return chromePath;
      }
    } catch (e) {
      // which 命令失败，继续其他方法
    }

    // ========== 方法2: mdfind 命令（Spotlight 搜索） ==========
    try {
      const mdfindResult = execSync(
        'mdfind "kMDItemKind == Application && kMDItemDisplayName == \'Google Chrome\'"',
        { 
          encoding: 'utf8', 
          timeout: 3000,
          stdio: ['pipe', 'pipe', 'ignore']
        }
      );
      
      const appPaths = mdfindResult.split('\n').map(p => p.trim()).filter(p => p.endsWith('.app'));
      for (const appPath of appPaths) {
        const chromePath = path.join(appPath, 'Contents', 'MacOS', 'Google Chrome');
        if (validateChrome(chromePath)) {
          return chromePath;
        }
      }
    } catch (e) {
      // mdfind 失败，继续其他方法
    }

    // ========== 方法3: 常见路径检测 ==========
    const possiblePaths = [
      // 系统级安装（最常见）
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      // 用户级安装
      path.join(process.env.HOME || '', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      // Chromium 变体
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(process.env.HOME || '', 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      // Chrome Canary
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      // Chrome Beta
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      // Chrome Dev
      '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'
    ];
    
    for (const chromePath of possiblePaths) {
      if (validateChrome(chromePath)) {
        return chromePath;
      }
    }

    // ========== 方法4: 扫描常见安装目录 ==========
    const searchDirs = [
      '/Applications',
      path.join(process.env.HOME || '', 'Applications'),
      '/opt/homebrew-cask/Caskroom',
      '/usr/local/Caskroom'
    ];
    
    for (const dir of searchDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (item.toLowerCase().includes('chrome') && item.endsWith('.app')) {
            const chromePath = path.join(dir, item, 'Contents', 'MacOS', 'Google Chrome');
            if (validateChrome(chromePath)) {
              return chromePath;
            }
            
            // 尝试其他可能的可执行文件名
            const altPath = path.join(dir, item, 'Contents', 'MacOS', item.replace('.app', ''));
            if (validateChrome(altPath)) {
              return altPath;
            }
          }
        }
      } catch (e) {
        // 继续下一个目录
      }
    }
    
    this.log(' 未找到 Chrome，将使用系统默认路径');
    return null;
  }

  /**
   * 注册单个账号
   */
  async registerAccount(logCallback) {
    this.logCallback = logCallback;
    let browser, page;
    let userDataDir = null; // 每次调用独立的用户数据目录
    
    try {
      // 检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      this.log('开始连接浏览器...');
      
      // 检测操作系统
      const platform = os.platform();
      const isWindows = platform === 'win32';
      const isMac = platform === 'darwin';
      
      if (!isWindows && !isMac) {
        throw new Error('不支持的操作系统，仅支持 Windows 和 Mac 系统');
      }
      
      // 检测 Chrome 浏览器路径
      this.log(`检测到 ${isWindows ? 'Windows' : 'macOS'} 系统，正在查找 Chrome 浏览器...`);
      const chromePath = this.detectChromePath();
      
      // 为每个任务创建独立的用户数据目录（解决多并发冲突问题）
      const tempDir = os.tmpdir();
      const uniqueId = `${Date.now()}_${this.instanceId}_${Math.random().toString(36).slice(2, 8)}`;
      userDataDir = path.join(tempDir, 'windsurf-tool-chrome', `instance_${uniqueId}`);
      this.log(`使用独立用户数据目录: instance_${uniqueId}`);
      
      // 配置浏览器连接参数
      const connectOptions = {
        headless: false,
        fingerprint: true,
        turnstile: true,
        tf: true,
        timeout: 120000, // 增加超时时间到 120 秒
        userDataDir: userDataDir, // 使用独立的用户数据目录
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu', // Windows 上禁用 GPU 加速
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--metrics-recording-only',
          '--disable-default-apps',
          '--mute-audio',
          '--no-first-run',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-background-timer-throttling',
          '--disable-ipc-flooding-protection',
          '--password-store=basic',
          '--use-mock-keychain'
        ]
      };
      
      // 如果找到了 Chrome 路径，使用指定路径
      if (chromePath) {
        connectOptions.executablePath = chromePath;
        this.log('使用检测到的 Chrome 路径');
      } else {
        this.log('使用系统默认 Chrome 路径');
      }
      
      this.log('正在启动 Chrome 浏览器...');
      this.log('提示: 如果长时间无响应，请检查:');
      this.log('  1. Chrome 浏览器是否正常安装');
      this.log('  2. 防火墙/杀毒软件是否拦截');
      this.log('  3. 是否有其他 Chrome 进程占用');
      
      let response;
      try {
        response = await connect(connectOptions);
      } catch (error) {
        this.log(`浏览器连接失败: ${error.message}`);
        if (error.message.includes('ECONNREFUSED')) {
          this.log('提示: Chrome 进程启动失败，可能原因:');
          this.log('  1. 端口被占用，请关闭其他 Chrome 实例');
          this.log('  2. Windows 防火墙拦截，请添加程序到白名单');
          this.log('  3. 杀毒软件拦截，请暂时关闭或添加信任');
          this.log('  4. Chrome 版本过旧，请更新到最新版本');
        }
        throw error;
      }
      
      this.log('Chrome 浏览器连接成功');
      
      browser = response.browser;
      page = response.page;
      
      if (!browser || !page) {
        throw new Error('浏览器或页面对象未创建');
      }
      
      this.log('浏览器已启动');
      
      // 检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      // 生成临时邮箱和密码
      const email = await this.generateTempEmail();
      
      // 根据配置选择密码生成方式
      const passwordMode = this.config.passwordMode || 'email'; // 默认使用邮箱作为密码
      let password;
      
      if (passwordMode === 'random') {
        // 使用随机密码
        password = this.generateRandomPassword();
        this.log(`密码模式: 随机密码`);
      } else {
        // 使用邮箱作为密码（默认）
        password = email;
        this.log(`密码模式: 邮箱作为密码`);
      }
      
      const { firstName, lastName } = this.generateRandomName();
      
      this.log(`邮箱: ${email}`);
      this.log(`密码: ${password}`);
      this.log(`姓名: ${firstName} ${lastName}`);
      
      // 访问注册页面（带重试机制）
      this.log('正在访问注册页面...');
      let navigationSuccess = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!navigationSuccess && retryCount < maxRetries) {
        try {
          retryCount++;
          this.log(`尝试访问注册页面 (${retryCount}/${maxRetries})`);
          
          // 生成带鉴权的注册URL
          const registrationUrl = this.generateRegistrationUrl();
          
          await page.goto(registrationUrl, {
            waitUntil: 'domcontentloaded', // 改为更宽松的等待条件
            timeout: 120000 // 增加到120秒
          });
          
          // 等待页面基本元素加载
          await page.waitForSelector('body', { timeout: 120000 });
          navigationSuccess = true;
          this.log('注册页面访问成功');
          
        } catch (error) {
          this.log(`第${retryCount}次访问失败: ${error.message}`);
          
          if (retryCount < maxRetries) {
            this.log(`等待5秒后重试...`);
            await this.sleep(5000);
          } else {
            throw new Error(`导航失败，已重试${maxRetries}次: ${error.message}`);
          }
        }
      }
      
      await this.sleep(1000);
      
      // 检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      // ========== 第一步: 填写基本信息 ==========
      this.log('步骤1: 填写基本信息');
      
      // 等待表单加载
      await page.waitForSelector('input', { timeout: 60000 });
      await this.sleep(1500); // 优化：减少到 1.5 秒
      
      this.log('开始填写表单字段...');
      
      // 填写所有输入框 - 改进的填写逻辑
      const allInputs = await page.$$('input');
      this.log(`找到 ${allInputs.length} 个输入框`);
      
      let emailFilled = false;
      let firstNameFilled = false;
      let lastNameFilled = false;
      
      for (let i = 0; i < allInputs.length; i++) {
        const input = allInputs[i];
        
        try {
          const type = await page.evaluate(el => el.type, input);
          const name = await page.evaluate(el => el.name, input);
          const placeholder = await page.evaluate(el => el.placeholder || '', input);
          const id = await page.evaluate(el => el.id || '', input);
          
          this.log(`输入框 ${i+1}: type=${type}, name=${name}, placeholder=${placeholder}, id=${id}`);
          
          // 填写邮箱 - 更精确的匹配
          if (!emailFilled && (type === 'email' || name === 'email' || 
              placeholder.toLowerCase().includes('email') || 
              id.toLowerCase().includes('email'))) {
            await this.sleep(200);
            await input.click({ clickCount: 3 }); // 三击选中所有内容
            await this.sleep(100);
            await input.type(email, { delay: 50 }); // 优化：加快输入速度
            await this.sleep(100);
            this.log(`已填写邮箱: ${email}`);
            emailFilled = true;
          }
          // 填写名字
          else if (!firstNameFilled && (name === 'firstName' || 
                   placeholder.toLowerCase().includes('first') || 
                   id.toLowerCase().includes('first'))) {
            await this.sleep(200);
            await input.click();
            await this.sleep(100);
            await input.type(firstName, { delay: 50 });
            await this.sleep(100);
            this.log(`已填写名字: ${firstName}`);
            firstNameFilled = true;
          }
          // 填写姓氏
          else if (!lastNameFilled && (name === 'lastName' || 
                   placeholder.toLowerCase().includes('last') || 
                   id.toLowerCase().includes('last'))) {
            await this.sleep(200);
            await input.click();
            await this.sleep(100);
            await input.type(lastName, { delay: 50 });
            await this.sleep(100);
            this.log(`已填写姓氏: ${lastName}`);
            lastNameFilled = true;
          }
        } catch (err) {
          this.log(`填写输入框 ${i+1} 时出错: ${err.message}`);
        }
      }
      
      // 验证是否所有必填字段都已填写
      if (!emailFilled) {
        throw new Error('未能填写邮箱字段，请检查页面结构');
      }
      this.log(`表单填写完成: 邮箱=${emailFilled}, 名字=${firstNameFilled}, 姓氏=${lastNameFilled}`);
      
      // 同意条款复选框
      await this.sleep(500);
      const checkbox = await page.$('input[type="checkbox"]');
      if (checkbox) {
        const isChecked = await page.evaluate(el => el.checked, checkbox);
        if (!isChecked) {
          await this.sleep(200);
          await checkbox.click();
          await this.sleep(200);
          // 验证是否勾选成功
          const nowChecked = await page.evaluate(el => el.checked, checkbox);
          this.log(`已勾选同意条款: ${nowChecked ? '成功' : '失败'}`);
        } else {
          this.log('条款复选框已勾选');
        }
      }
      
      await this.sleep(800); // 优化：减少等待时间
      
      // 点击Continue按钮
      this.log('查找并点击Continue按钮...');
      const clicked = await this.clickButton(page, ['Continue', '继续', 'Next'], 3); // 增加重试次数
      
      if (!clicked) {
        this.log('未找到Continue按钮，尝试查找submit按钮...');
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) {
          await submitBtn.click();
          this.log('已点击submit按钮');
        } else {
          throw new Error('无法找到Continue或submit按钮');
        }
      }
      
      await this.sleep(2000); // 优化：减少到2秒
      
      // 检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      // ========== 第二步: 填写密码 ==========
      this.log('步骤2: 填写密码信息');
      
      // 等待密码页面加载
      await page.waitForSelector('input[type="password"]', { timeout: 60000 });
      await this.sleep(1500); // 优化：减少到1.5秒
      
      // 查找所有密码输入框
      const passwordInputs = await page.$$('input[type="password"]');
      this.log(`找到 ${passwordInputs.length} 个密码输入框`);
      
      if (passwordInputs.length === 0) {
        throw new Error('未找到密码输入框');
      }
      
      // 填写第一个密码输入框
      this.log('填写密码...');
      await this.sleep(200);
      await passwordInputs[0].click();
      await this.sleep(100);
      await passwordInputs[0].type(password, { delay: 50 }); // 优化：加快输入速度
      await this.sleep(200);
      
      // 验证密码是否填写成功
      const pwd1Value = await page.evaluate(el => el.value, passwordInputs[0]);
      this.log(`密码填写验证: ${pwd1Value.length > 0 ? '成功' : '失败'} (长度: ${pwd1Value.length})`);
      
      // 填写确认密码（如果有）
      if (passwordInputs.length >= 2) {
        this.log('填写确认密码...');
        await this.sleep(200);
        await passwordInputs[1].click();
        await this.sleep(100);
        await passwordInputs[1].type(password, { delay: 50 });
        await this.sleep(200);
        
        // 验证确认密码
        const pwd2Value = await page.evaluate(el => el.value, passwordInputs[1]);
        this.log(`确认密码验证: ${pwd2Value.length > 0 ? '成功' : '失败'} (长度: ${pwd2Value.length})`);
      }
      
      await this.sleep(800); // 优化：减少等待时间
      
      // 点击第二个Continue按钮
      this.log('查找并点击第二个Continue按钮...');
      const clicked2 = await this.clickButton(page, ['Continue', '继续', 'Next'], 3);
      
      if (!clicked2) {
        this.log('未找到Continue按钮，尝试查找submit按钮...');
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) {
          await submitBtn.click();
          this.log('已点击submit按钮');
        } else {
          throw new Error('无法找到第二个Continue或submit按钮');
        }
      }
      
      await this.sleep(2000); // 优化：减少到2秒
      
      // 检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      // ========== 第三步: Cloudflare人机验证 ==========
      this.log('步骤3: 等待Cloudflare验证...');
      this.log('提示: 如果出现人机验证，请在浏览器中完成验证');
      
      // puppeteer-real-browser会自动处理Cloudflare Turnstile验证
      await this.sleep(5000); // 优化：减少到5秒
      
      // 点击验证后的Continue按钮
      this.log('查找验证后的Continue按钮...');
      const clicked3 = await this.clickButton(page, ['Continue', '继续', 'Next'], 5); // 增加重试次数
      
      if (!clicked3) {
        this.log('未找到Continue按钮,可能已自动跳转或需要手动操作');
      }
      
      await this.sleep(2000); // 优化：减少到2秒
      
      // ========== 第四步: 输入验证码 ==========
      this.log('步骤4: 等待邮箱验证码...');
      
      // 等待验证码输入框
      await page.waitForSelector('input[type="text"], input[name="code"]', { timeout: 120000 });
      
      // 检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      // 延迟3-6秒后再获取验证码（优化：减少等待时间）
      const randomDelay = 3000 + Math.floor(Math.random() * 3000); // 3-6秒随机延迟
      this.log(`延迟 ${Math.floor(randomDelay/1000)} 秒后获取验证码...`);
      await this.sleep(randomDelay);
      
      // 再次检查取消标志
      if (this.isCancelled) {
        throw new Error('注册已取消');
      }
      
      // 获取验证码
      this.log('正在接收验证码...');
      const verificationCode = await this.getVerificationCode(email);
      this.log(`获取到验证码: ${verificationCode}`);
      
      // 输入6位验证码 - 优化的输入逻辑
      const codeInputs = await page.$$('input[type="text"], input[name="code"]');
      this.log(`找到 ${codeInputs.length} 个验证码输入框`);
      
      if (codeInputs.length === 6) {
        // 如果是6个独立输入框
        this.log('检测到6个独立验证码输入框，逐个填写...');
        for (let i = 0; i < 6; i++) {
          await this.sleep(100);
          await codeInputs[i].click();
          await this.sleep(80);
          await codeInputs[i].type(verificationCode[i], { delay: 80 });
          this.log(`已输入第 ${i+1} 位: ${verificationCode[i]}`);
        }
      } else if (codeInputs.length === 1) {
        // 如果是单个输入框
        this.log('检测到单个验证码输入框，一次性填写...');
        await this.sleep(300);
        await codeInputs[0].click();
        await this.sleep(150);
        await codeInputs[0].type(verificationCode, { delay: 80 });
        
        // 验证输入是否成功
        const inputValue = await page.evaluate(el => el.value, codeInputs[0]);
        this.log(`验证码输入验证: ${inputValue === verificationCode ? '成功' : '失败'} (输入值: ${inputValue})`);
      } else {
        this.log(`未找到标准的验证码输入框，找到 ${codeInputs.length} 个输入框`);
      }
      
      await this.sleep(1000); // 优化：减少等待时间
      
      // 点击Create account按钮
      this.log('查找并点击Create account按钮...');
      const createBtn = await page.$('button[type="submit"]');
      if (createBtn) {
        await this.sleep(300);
        await createBtn.click();
        this.log('已点击Create account按钮');
      } else {
        this.log('未找到Create account按钮，可能自动提交');
      }
      await this.sleep(4000); // 优化：减少到4秒
      
      // ========== 检查注册是否成功 ==========
      this.log('检查注册状态...');
      await this.sleep(2000); // 优化：减少到2秒
      
      const currentUrl = page.url();
      this.log(`当前URL: ${currentUrl}`);
      const isSuccess = !currentUrl.includes('/login') && !currentUrl.includes('/signup');
      
      if (isSuccess) {
        console.log('注册成功!');
        this.log('注册成功!');

        this.log('正在校验新账号凭据...');
        const verificationResult = await this.verifyAccountCredentials(email, password);
        if (!verificationResult.success) {
          this.log(`网页注册已完成，但账号凭据校验失败: ${verificationResult.error}`);
          return {
            success: false,
            partialSuccess: true,
            webSuccess: true,
            email,
            password,
            firstName,
            lastName,
            name: `${firstName} ${lastName}`,
            error: `网页注册成功，但账号密码登录校验失败: ${verificationResult.error}`
          };
        }
        this.log('账号凭据校验通过');
        
        // 保存账号到本地（只保存邮箱和密码，Token 后续通过登录获取）
        const account = {
          email,
          password,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`
        };
        
        // 使用回调函数保存账号，自动使用文件锁
        let saveSuccess = false;
        let saveError = null;
        
        try {
          if (this.saveAccountCallback) {
            const addResult = await this.saveAccountCallback(account);
            if (addResult.success) {
              console.log('账号已保存到本地');
              this.log('账号已保存到本地');
              saveSuccess = true;
            } else {
              console.warn('保存账号失败:', addResult.error);
              this.log(`保存账号失败: ${addResult.error}`);
              saveError = addResult.error;
            }
          } else {
            console.warn('未提供保存账号回调函数');
            this.log('未提供保存账号回调函数');
            saveError = '未提供保存账号回调函数';
          }
        } catch (error) {
          console.error('保存账号异常:', error);
          this.log(`保存账号异常: ${error.message}`);
          saveError = error.message;
        }
        
        // 如果保存失败，返回失败状态
        if (!saveSuccess) {
          return {
            success: false,
            error: `注册成功但保存失败: ${saveError}`,
            email,
            password,
            partialSuccess: true  // 标记为部分成功（注册成功但保存失败）
          };
        }
        
        return {
          success: true,
          email,
          password,
          firstName,
          lastName,
          name: account.name
        };
      } else {
        throw new Error('注册失败，请检查页面');
      }
      
    } catch (error) {
      console.error('注册过程出错:', error);
      console.error('错误堆栈:', error.stack);
      
      // 如果是取消操作，返回特殊标记
      if (error.message === '注册已取消' || this.isCancelled) {
        return {
          success: false,
          cancelled: true,
          error: '注册已取消'
        };
      }
      
      return {
        success: false,
        error: error.message || '未知错误',
        errorStack: error.stack
      };
    } finally {
      // 关闭浏览器 - 优化的关闭逻辑
      if (browser) {
        try {
          // 检查浏览器是否还在运行
          const isConnected = browser.isConnected();
          if (isConnected) {
            // 给用户一些时间查看最终状态（仅在非取消情况下）
            if (!this.isCancelled) {
              this.log('注册流程完成，1秒后关闭浏览器...');
              await this.sleep(1000);
            }
            
            await browser.close();
            console.log('浏览器已关闭');
            this.log('浏览器已关闭');
          } else {
            console.log('浏览器已被外部关闭');
            this.log('浏览器已被外部关闭');
          }
        } catch (e) {
          console.error('关闭浏览器失败:', e.message);
          this.log(`关闭浏览器时出错: ${e.message}`);
        }
        
        // 清理临时用户数据目录
        if (userDataDir) {
          try {
            const fs = require('fs');
            if (fs.existsSync(userDataDir)) {
              fs.rmSync(userDataDir, { recursive: true, force: true });
              console.log('临时目录已清理:', userDataDir);
            }
          } catch (cleanupError) {
            console.warn('清理临时目录失败:', cleanupError.message);
          }
        }
      }
    }
  }

  /**
   * 批量注册(控制并发数量)
   * 支持自定义并发数量，支持平台特定优化
   */
  async batchRegister(count, maxConcurrent = 4, progressCallback, logCallback) {
    // 重置取消标志
    this.isCancelled = false;
    
    // 尊重用户设置的并发数，不做硬性限制
    const userConcurrent = maxConcurrent || 4;
    const MAX_CONCURRENT = Math.min(userConcurrent, count); // 不超过总数量即可
    
    // 如果用户设置超过建议值，给出警告
    if (userConcurrent > 3 && logCallback) {
      logCallback(`提示: 并发数 ${userConcurrent} 超过建议值(3)，建议降低以提高成功率`);
    }
    
    // 平台特定的延迟参数（优化：减少等待时间）
    const platform = os.platform();
    const isWindows = platform === 'win32';
    const windowStartDelay = isWindows ? 3000 : 2000; // 窗口启动间隔：Windows 3秒，macOS 2秒
    const batchInterval = isWindows ? 5000 : 3000; // 批次间隔：Windows 5秒，macOS 3秒
    
    if (logCallback) {
      logCallback(`开始批量注册 ${count} 个账号`);
      logCallback(`最大并发数: ${MAX_CONCURRENT} 个窗口（已优化）`);
      logCallback(`窗口启动间隔: ${windowStartDelay/1000} 秒`);
      logCallback(`验证码延迟: 3-6 秒随机`);
      logCallback(`批次间隔: ${batchInterval/1000} 秒`);
      logCallback(`平台: ${platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'}`);
    }
    
    const results = [];
    let completed = 0;
    let successCount = 0;
    let failedCount = 0;
    
    // 分批执行，每批最多 MAX_CONCURRENT 个
    for (let i = 0; i < count; i += MAX_CONCURRENT) {
      // 检查取消标志
      if (this.isCancelled) {
        if (logCallback) {
          logCallback('\n批量注册已取消');
        }
        break;
      }
      const batchSize = Math.min(MAX_CONCURRENT, count - i);
      const batchTasks = [];
      
      if (logCallback) {
        logCallback(`\n========== 第 ${Math.floor(i/MAX_CONCURRENT) + 1} 批次，注册 ${batchSize} 个账号 ==========`);
      }
      
      // 创建当前批次的任务
      for (let j = 0; j < batchSize; j++) {
        const taskIndex = i + j + 1;
        
        // 为每个任务创建独立的日志回调
        const taskLogCallback = (log) => {
          if (logCallback) {
            logCallback(`[窗口${taskIndex}] ${log}`);
          }
        };
        
        // 每个窗口间隔启动，避免验证码混淆（优化后）
        const startDelay = j * windowStartDelay; // 使用平台特定的启动延迟
        
        const task = (async () => {
          await this.sleep(startDelay);
          
          // 检查取消标志
          if (this.isCancelled) {
            return {
              success: false,
              cancelled: true,
              error: '注册已取消'
            };
          }
          
          if (logCallback) {
            logCallback(`\n[窗口${taskIndex}] 开始注册...`);
          }
          
          // 添加失败重试机制（最多重试1次）
          let result = await this.registerAccount(taskLogCallback);
          
          if (!result.success && !result.cancelled && !result.partialSuccess) {
            if (logCallback) {
              logCallback(`[窗口${taskIndex}] 首次失败，等待10秒后重试...`);
            }
            await this.sleep(10000);
            
            if (!this.isCancelled) {
              if (logCallback) {
                logCallback(`[窗口${taskIndex}] 开始重试...`);
              }
              result = await this.registerAccount(taskLogCallback);
              
              if (result.success) {
                if (logCallback) {
                  logCallback(`[窗口${taskIndex}] 重试成功！`);
                }
              }
            }
          }
          
          completed++;
          
          // 更新成功/失败计数
          if (result.success) {
            successCount++;
          } else if (!result.cancelled) {
            failedCount++;
          }
          
          // 发送实时进度更新
          if (progressCallback) {
            progressCallback({ 
              current: completed, 
              total: count,
              success: successCount,
              failed: failedCount
            });
          }
          
          if (logCallback) {
            if (result.success) {
              logCallback(`[窗口${taskIndex}] 注册成功! 邮箱: ${result.email}`);
            } else if (result.cancelled) {
              logCallback(`[窗口${taskIndex}] 已取消`);
            } else if (result.partialSuccess) {
              logCallback(`[窗口${taskIndex}] 网页注册成功，但工具登录校验未通过: ${result.error}`);
            } else {
              logCallback(`[窗口${taskIndex}] 注册失败: ${result.error}`);
            }
          }
          
          return result;
        })();
        
        batchTasks.push(task);
      }
      
      // 等待当前批次完成
      const batchResults = await Promise.all(batchTasks);
      results.push(...batchResults);
      
      // 检查取消标志
      if (this.isCancelled) {
        if (logCallback) {
          logCallback('\n批量注册已取消，停止后续批次');
        }
        break;
      }
      
      // 如果还有下一批，等待一段时间再开始（优化后）
      if (i + MAX_CONCURRENT < count) {
        if (logCallback) {
          logCallback(`\n等待 ${batchInterval/1000} 秒后开始下一批次...`);
        }
        
        // 分段等待，以便快速响应取消操作
        for (let wait = 0; wait < batchInterval; wait += 500) {
          if (this.isCancelled) break;
          await this.sleep(500);
        }
      }
    }
    
    if (logCallback) {
      const successCount = results.filter(r => r.success).length;
      const cancelledCount = results.filter(r => r.cancelled).length;
      const failedCount = results.filter(r => !r.success && !r.cancelled).length;
      
      if (this.isCancelled) {
        logCallback(`\n========== 批量注册已取消 ==========`);
      } else {
        logCallback(`\n========== 批量注册完成 ==========`);
      }
      
      logCallback(`成功: ${successCount} 个`);
      logCallback(`失败: ${failedCount} 个`);
      if (cancelledCount > 0) {
        logCallback(`取消: ${cancelledCount} 个`);
      }
    }
    
    return results;
  }

  /**
   * 取消批量注册（跨平台支持）
   */
  async cancel(logCallback = null) {
    const BrowserKiller = require('./registrationBotCancel');
    await BrowserKiller.cancelBatchRegistration(this, logCallback);
  }


  /**
   * 点击按钮的辅助方法（优化版）
   * @param {Page} page - Puppeteer页面对象
   * @param {Array} textList - 按钮文本列表
   * @param {Number} retries - 重试次数
   */
  async clickButton(page, textList = ['Continue'], retries = 1) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // 等待页面稳定
        await this.sleep(500);
        
        // 方式1: 通过 type=submit
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) {
          const isVisible = await page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, submitBtn);
          
          if (isVisible) {
            await this.sleep(200);
            await submitBtn.click();
            await this.sleep(200);
            this.log('按钮点击成功 (submit)');
            return true;
          }
        }
      } catch (e) {
        this.log(`方式1失败: ${e.message}`);
      }
      
      try {
        // 方式2: 通过文本内容查找
        const buttons = await page.$$('button');
        this.log(`找到 ${buttons.length} 个按钮元素`);
        
        for (let i = 0; i < buttons.length; i++) {
          const btn = buttons[i];
          const text = await page.evaluate(el => el.textContent?.trim() || '', btn);
          const isVisible = await page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          }, btn);
          
          if (text && isVisible) {
            this.log(`按钮 ${i+1}: "${text}" (可见: ${isVisible})`);
            
            for (const searchText of textList) {
              if (text.includes(searchText)) {
                await this.sleep(200);
                await btn.click();
                await this.sleep(200);
                this.log(`按钮点击成功: "${searchText}"`);
                return true;
              }
            }
          }
        }
      } catch (e) {
        this.log(`方式2失败: ${e.message}`);
      }
      
      // 方式3: 尝试通过aria-label查找
      try {
        for (const searchText of textList) {
          const ariaBtn = await page.$(`button[aria-label*="${searchText}"]`);
          if (ariaBtn) {
            await this.sleep(500);
            await ariaBtn.click();
            await this.sleep(500);
            this.log(`按钮点击成功 (aria-label: ${searchText})`);
            return true;
          }
        }
      } catch (e) {
        this.log(`方式3失败: ${e.message}`);
      }
      
      if (attempt < retries - 1) {
        this.log(`第${attempt + 1}次未找到按钮，等待2秒后重试...`);
        await this.sleep(2000);
      } else {
        this.log(`尝试了${retries}次仍未找到可点击的按钮`);
      }
    }
    
    return false;
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RegistrationBot;
