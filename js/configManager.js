// configManager.js - 配置管理模块
// 使用全局的 ipcRenderer (通过 window.ipcRenderer 访问)
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// 用户数据路径缓存
let userDataPathCache = null;

// 配置管理器
const ConfigManager = {
  // 配置缓存
  configCache: null,
  
  // 初始化
  async initialize() {
    try {
      // 确保用户数据路径存在
      const userDataPath = this.getUserDataPath();
      await fs.mkdir(userDataPath, { recursive: true });
      
      // 创建默认配置文件（如果不存在）
      const configPath = this.getConfigFilePath();
      try {
        await fs.access(configPath);
        console.log('配置文件已存在:', configPath);
      } catch (error) {
        // 文件不存在，创建默认配置
        const defaultConfig = {
          emailDomains: ['example.com'],
          emailConfig: null,
          passwordMode: 'email', // 密码模式：'email'(邮箱作为密码) 或 'random'(随机密码)
          workerUrl: '',
          lastUpdate: new Date().toISOString(),
          platform: process.platform
        };
        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log('默认配置文件已创建:', configPath);
      }
      
      // 创建账号文件（如果不存在）
      const accountsPath = this.getAccountsFilePath();
      try {
        await fs.access(accountsPath);
        console.log('账号文件已存在:', accountsPath);
      } catch (error) {
        await fs.writeFile(accountsPath, JSON.stringify([], null, 2));
        console.log('空的账号文件已创建:', accountsPath);
      }
      
      return true;
    } catch (error) {
      console.error('初始化配置管理器失败:', error);
      return false;
    }
  },
  
  // 获取用户数据路径
  getUserDataPath() {
    // 如果有缓存，直接返回
    if (userDataPathCache) {
      return userDataPathCache;
    }

    // 尝试使用IPC获取
    try {
      // 先尝试同步获取默认路径
      const homeDir = os.homedir();
      let appName = 'windsurf-tool';
      
      // 根据平台选择默认路径
      if (process.platform === 'win32') {
        // Windows路径
        userDataPathCache = path.join(homeDir, 'AppData', 'Roaming', appName);
      } else if (process.platform === 'darwin') {
        // macOS路径
        userDataPathCache = path.join(homeDir, 'Library', 'Application Support', appName);
      } else {
        // Linux和其他平台
        userDataPathCache = path.join(homeDir, '.config', appName);
      }
      
      console.log('使用默认用户数据路径:', userDataPathCache);
      return userDataPathCache;
    } catch (error) {
      console.error('获取用户数据路径失败:', error);
      // 备用路径：在用户主目录下创建.windsurf-tool文件夹
      userDataPathCache = path.join(os.homedir(), '.windsurf-tool');
      console.log('使用备用用户数据路径:', userDataPathCache);
      return userDataPathCache;
    }
  },
  
  // 获取配置文件路径
  getConfigFilePath() {
    return path.join(this.getUserDataPath(), 'windsurf-app-config.json');
  },
  
  // 获取账号文件路径
  getAccountsFilePath() {
    return path.join(this.getUserDataPath(), 'accounts.json');
  },
  
  // 加载配置
  async loadConfig() {
    try {
      // 如果已经有缓存，直接返回
      if (this.configCache) {
        console.log('使用配置缓存');
        return { success: true, config: this.configCache };
      }
      
      console.log('尝试加载配置文件...');
      
      // 尝试使用IPC加载
      try {
        console.log('尝试使用IPC加载配置...');
        const result = await window.ipcRenderer.invoke('load-windsurf-config');
        if (result.success) {
          console.log('IPC加载配置成功');
          this.configCache = result.config;
          return result;
        }
      } catch (ipcError) {
        console.warn('IPC加载配置失败，尝试直接读取文件:', ipcError);
      }
      
      // 如果IPC失败，尝试直接读取文件
      try {
        const configFile = this.getConfigFilePath();
        console.log('尝试直接读取配置文件:', configFile);
        
        // 检查文件是否存在
        try {
          await fs.access(configFile);
          console.log('配置文件存在，尝试读取...');
        } catch (accessError) {
          console.log('配置文件不存在，将创建默认配置');
          // 创建默认配置
          const defaultConfig = {
            emailDomains: ['example.com'],
            emailConfig: null,
            passwordMode: 'email', // 密码模式：'email'(邮箱作为密码) 或 'random'(随机密码)
            workerUrl: '',
            lastUpdate: new Date().toISOString(),
            platform: process.platform
          };
          
          // 确保目录存在
          await fs.mkdir(path.dirname(configFile), { recursive: true });
          
          // 写入默认配置
          await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2));
          console.log('默认配置文件已创建:', configFile);
          
          this.configCache = defaultConfig;
          return { success: true, config: defaultConfig };
        }
        
        // 读取文件
        const data = await fs.readFile(configFile, 'utf-8');
        console.log('文件内容读取成功，尝试解析JSON...');
        
        const config = JSON.parse(data);
        this.configCache = config;
        console.log('直接读取配置文件成功');
        return { success: true, config };
      } catch (fileError) {
        console.warn('直接读取配置文件失败:', fileError);
        console.log('使用默认配置...');
        
        // 使用默认配置
        const defaultConfig = {
          emailDomains: ['example.com'],
          emailConfig: null,
          passwordMode: 'email', // 密码模式：'email'(邮箱作为密码) 或 'random'(随机密码)
          workerUrl: '',
          lastUpdate: new Date().toISOString(),
          platform: process.platform
        };
        
        this.configCache = defaultConfig;
        return { success: true, config: defaultConfig };
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 保存配置
  async saveConfig(config) {
    try {
      // 更新缓存
      this.configCache = config;
      
      // 尝试使用IPC保存
      try {
        return await window.ipcRenderer.invoke('save-windsurf-config', config);
      } catch (ipcError) {
        console.warn('IPC保存配置失败，尝试直接写入文件:', ipcError);
      }
      
      // 如果IPC失败，尝试直接写入文件
      try {
        const configFile = this.getConfigFilePath();
        
        // 确保目录存在
        await fs.mkdir(path.dirname(configFile), { recursive: true });
        
        // 写入配置
        await fs.writeFile(configFile, JSON.stringify(config, null, 2));
        console.log('直接写入配置文件成功:', configFile);
        return { success: true, message: '配置已保存' };
      } catch (fileError) {
        console.error('直接写入配置文件失败:', fileError);
        return { success: false, error: fileError.message };
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 获取特定配置项
  async getConfigItem(key, defaultValue = null) {
    const result = await this.loadConfig();
    if (result.success && result.config) {
      return result.config[key] !== undefined ? result.config[key] : defaultValue;
    }
    return defaultValue;
  },
  
  // 设置特定配置项
  async setConfigItem(key, value) {
    const result = await this.loadConfig();
    if (result.success && result.config) {
      const updatedConfig = { ...result.config, [key]: value };
      return await this.saveConfig(updatedConfig);
    }
    return { success: false, error: '加载配置失败' };
  },
  
  // 加载账号列表
  async loadAccounts() {
    try {
      console.log('尝试加载账号列表...');
      
      // 尝试使用IPC加载
      try {
        console.log('尝试使用IPC加载账号...');
        const result = await window.ipcRenderer.invoke('get-accounts');
        if (result.success) {
          console.log('IPC加载账号成功，共' + (result.accounts ? result.accounts.length : 0) + '个账号');
          return result;
        }
      } catch (ipcError) {
        console.warn('IPC加载账号失败，尝试直接读取文件:', ipcError);
      }
      
      // 如果IPC失败，尝试直接读取文件
      try {
        const accountsFile = this.getAccountsFilePath();
        console.log('尝试直接读取账号文件:', accountsFile);
        
        // 检查文件是否存在
        try {
          await fs.access(accountsFile);
          console.log('账号文件存在，尝试读取...');
        } catch (accessError) {
          console.log('账号文件不存在，将创建空文件');
          // 创建空文件
          await fs.mkdir(path.dirname(accountsFile), { recursive: true });
          await fs.writeFile(accountsFile, JSON.stringify([], null, 2));
          console.log('空的账号文件已创建:', accountsFile);
          return { success: true, accounts: [] };
        }
        
        // 读取文件
        const data = await fs.readFile(accountsFile, 'utf-8');
        console.log('文件内容读取成功，尝试解析JSON...');
        
        const accounts = JSON.parse(data);
        console.log('直接读取账号文件成功，共' + (Array.isArray(accounts) ? accounts.length : 0) + '个账号');
        return { success: true, accounts: Array.isArray(accounts) ? accounts : [] };
      } catch (fileError) {
        console.warn('直接读取账号文件失败:', fileError);
        console.log('返回空账号列表');
        return { success: true, accounts: [] };
      }
    } catch (error) {
      console.error('加载账号失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 保存账号列表
  async saveAccounts(accounts) {
    try {
      // 尝试使用IPC保存
      try {
        // 注意：这里没有直接的IPC方法保存整个账号列表，所以我们直接写入文件
        const accountsFile = this.getAccountsFilePath();
        
        // 确保目录存在
        await fs.mkdir(path.dirname(accountsFile), { recursive: true });
        
        // 写入账号列表
        await fs.writeFile(accountsFile, JSON.stringify(accounts, null, 2));
        console.log('直接写入账号文件成功:', accountsFile);
        return { success: true, message: '账号已保存' };
      } catch (error) {
        console.error('保存账号失败:', error);
        return { success: false, error: error.message };
      }
    } catch (error) {
      console.error('保存账号失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 添加账号
  async addAccount(account) {
    try {
      // 尝试使用IPC添加
      try {
        return await window.ipcRenderer.invoke('add-account', account);
      } catch (ipcError) {
        console.warn('IPC添加账号失败，尝试直接操作:', ipcError);
      }
      
      // 如果IPC失败，尝试直接操作
      const result = await this.loadAccounts();
      if (result.success) {
        const accounts = result.accounts || [];
        
        // 添加ID和创建时间
        account.id = Date.now().toString();
        account.createdAt = new Date().toISOString();
        
        accounts.push(account);
        return await this.saveAccounts(accounts);
      }
      return { success: false, error: '加载账号失败' };
    } catch (error) {
      console.error('添加账号失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 更新账号
  async updateAccount(accountUpdate) {
    try {
      // 尝试使用IPC更新
      try {
        return await window.ipcRenderer.invoke('update-account', accountUpdate);
      } catch (ipcError) {
        console.warn('IPC更新账号失败，尝试直接操作:', ipcError);
      }
      
      // 如果IPC失败，尝试直接操作
      const result = await this.loadAccounts();
      if (result.success) {
        const accounts = result.accounts || [];
        
        // 查找要更新的账号
        const index = accounts.findIndex(acc => acc.id === accountUpdate.id);
        if (index === -1) {
          return { success: false, error: '账号不存在' };
        }
        
        // 更新账号
        accounts[index] = { ...accounts[index], ...accountUpdate, updatedAt: new Date().toISOString() };
        
        return await this.saveAccounts(accounts);
      }
      return { success: false, error: '加载账号失败' };
    } catch (error) {
      console.error('更新账号失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 获取所有文件路径（跨平台）
  async getFilePaths() {
    try {
      // 尝试使用IPC获取
      try {
        const result = await window.ipcRenderer.invoke('get-file-paths');
        if (result.success) {
          console.log('通过IPC获取文件路径成功');
          return result;
        }
      } catch (ipcError) {
        console.warn('IPC获取文件路径失败，使用本地计算:', ipcError);
      }
      
      // 如果IPC失败，使用本地计算
      const userDataPath = this.getUserDataPath();
      const configFile = this.getConfigFilePath();
      const accountsFile = this.getAccountsFilePath();
      
      return {
        success: true,
        paths: {
          userDataPath: userDataPath,
          configFile: configFile,
          accountsFile: accountsFile,
          platform: process.platform
        }
      };
    } catch (error) {
      console.error('获取文件路径失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConfigManager;
}

// 在浏览器环境中暴露为全局变量
if (typeof window !== 'undefined') {
  window.ConfigManager = ConfigManager;
}
