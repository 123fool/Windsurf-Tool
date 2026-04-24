const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// 修复 asar 中 ESM 模块动态导入问题
// 将解压的 node_modules 添加到模块搜索路径
const Module = require('module');

// 计算 asar.unpacked 的路径
const isPackaged = __dirname.includes('app.asar');
const unpackedNodeModules = isPackaged 
  ? path.join(__dirname, '..', 'app.asar.unpacked', 'node_modules')
  : path.join(__dirname, 'node_modules');

// 将解压的 node_modules 添加到全局模块路径（最高优先级）
if (isPackaged && !Module.globalPaths.includes(unpackedNodeModules)) {
  Module.globalPaths.unshift(unpackedNodeModules);
}

// 同时修改 NODE_PATH 环境变量，影响 ESM 导入
if (isPackaged) {
  const currentNodePath = process.env.NODE_PATH || '';
  process.env.NODE_PATH = unpackedNodeModules + path.delimiter + currentNodePath;
  Module._initPaths();
}

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  // 如果是 chrome-launcher 相关的导入，尝试从 asar.unpacked 加载
  if (request === 'chrome-launcher' || request.startsWith('chrome-launcher/')) {
    const unpackedPath = path.join(unpackedNodeModules, request);
    try {
      return originalResolveFilename.call(this, unpackedPath, parent, isMain, options);
    } catch (e) {
      // 如果失败，继续使用原始解析
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const accountsFileLock = require('./src/accountsFileLock');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 处理 EPIPE 错误（管道关闭时的写入错误）
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

let mainWindow;
// 当前批量注册的机器人实例，用于支持跨平台取消
let currentRegistrationBot = null;
let isForceUpdateActive = false;
let isMaintenanceModeActive = false;
let isApiUnavailable = false;
let versionCheckInterval = null;

// 应用名称 - 必须设置为 'Windsurf' 以使用相同的 Keychain 密钥
app.setName('Windsurf');

// 设置独立的用户数据目录（不与 Windsurf 共享）
// 注意：必须在复制 Local State 之前设置，确保路径一致
const appDataPath = app.getPath('appData');
const toolUserData = path.join(appDataPath, 'windsurf-tool');
app.setPath('userData', toolUserData);

// Windows: 复制 Windsurf 的 Local State 文件到工具目录
// 这样 safeStorage 才能正确加密/解密数据
if (process.platform === 'win32') {
  const windsurfUserData = path.join(appDataPath, 'Windsurf');
  const windsurfLocalState = path.join(windsurfUserData, 'Local State');
  const toolLocalState = path.join(toolUserData, 'Local State');
  
  try {
    const fs = require('fs');
    // 确保工具目录存在
    if (!fs.existsSync(toolUserData)) {
      fs.mkdirSync(toolUserData, { recursive: true });
    }
    
    // 如果 Windsurf 的 Local State 存在，复制到工具目录
    if (fs.existsSync(windsurfLocalState)) {
      // 每次启动都检查并更新 Local State（确保使用最新的加密密钥）
      const shouldCopy = !fs.existsSync(toolLocalState) || 
                        fs.statSync(windsurfLocalState).mtimeMs > fs.statSync(toolLocalState).mtimeMs;
      
      if (shouldCopy) {
        fs.copyFileSync(windsurfLocalState, toolLocalState);
        console.log('[初始化] 已复制 Windsurf Local State 到工具目录');
        console.log(`[初始化]    源: ${windsurfLocalState}`);
        console.log(`[初始化]    目标: ${toolLocalState}`);
      } else {
        console.log('[初始化]   Local State 已是最新，无需复制');
      }
    } else {
      console.warn('[初始化] 未找到 Windsurf Local State，加密可能失败');
      console.warn(`[初始化]    期望路径: ${windsurfLocalState}`);
      console.warn('[初始化]    请确保 Windsurf 已安装并至少运行过一次');
    }
  } catch (error) {
    console.error('[初始化] 复制 Local State 失败:', error.message);
  }
}

// 跨平台安全路径获取函数
function getSafePath(base, ...paths) {
  return path.join(base, ...paths);
}

// 应用配置路径
const userDataPath = app.getPath('userData');
const ACCOUNTS_FILE = getSafePath(userDataPath, 'accounts.json');


function createWindow() {
  console.log('开始创建主窗口...');
  console.log('平台:', process.platform);
  console.log('架构:', process.arch);
  console.log('Electron版本:', process.versions.electron);
  console.log('Node版本:', process.versions.node);
  
  const isWin = process.platform === 'win32';
  const isMacOS = process.platform === 'darwin';
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: !app.isPackaged, // 生产环境禁用开发者工具
      webviewTag: true,
      webSecurity: false, // 允许加载本地资源
      allowRunningInsecureContent: true // 允许运行不安全的内容（开发环境）
    },
    title: 'Windsurf-Tool',
    show: false, // 先不显示，等加载完成
    autoHideMenuBar: !isMacOS // Windows/Linux 自动隐藏菜单栏，按 Alt 显示
    // 注意：移除了 Windows titleBarStyle: 'hidden' 配置，恢复原生标题栏以支持拖拽
  });
  
  console.log('主窗口创建成功');

  // 加载完成后显示窗口
  mainWindow.once('ready-to-show', () => {
    console.log('窗口准备就绪，开始显示');
    mainWindow.show();
  });

  // 监听渲染进程崩溃
  mainWindow.webContents.on('crashed', () => {
    console.error('渲染进程崩溃');
    console.error('平台:', process.platform);
    console.error('时间:', new Date().toISOString());
    dialog.showErrorBox('应用崩溃', '渲染进程崩溃，请重启应用\n\n平台: ' + process.platform + '\n时间: ' + new Date().toLocaleString());
  });

  // 监听加载失败
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('页面加载失败:', errorCode, errorDescription);
    console.error('平台:', process.platform);
    console.error('时间:', new Date().toISOString());
    
    // Windows特殊处理
    if (process.platform === 'win32') {
      console.error('🔧 Windows调试信息:');
      console.error('  - 用户数据路径:', app.getPath('userData'));
      console.error('  - 应用路径:', app.getAppPath());
      console.error('  - 是否打包:', app.isPackaged);
    }
  });
  
  // 监听来自渲染进程的强制更新状态
  ipcMain.on('set-force-update-status', (event, status) => {
    isForceUpdateActive = status;
    console.log('强制更新状态:', status ? '激活' : '关闭');
    
    // 强制更新时禁用开发者工具
    if (status && app.isPackaged) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      }
    }
  });
  
  // 监听开发者工具打开事件
  mainWindow.webContents.on('devtools-opened', () => {
    if (isForceUpdateActive || isMaintenanceModeActive || isApiUnavailable) {
      console.log('检测到开发者工具打开，强制关闭');
      mainWindow.webContents.closeDevTools();
      
      // 发送警告到渲染进程
      mainWindow.webContents.send('devtools-blocked', {
        reason: isForceUpdateActive ? '强制更新模式' : isMaintenanceModeActive ? '维护模式' : 'API 无法访问'
      });
    }
  });
  
  // 处理快捷键
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // 检测刷新快捷键：Cmd+R (macOS) 或 Ctrl+R (Windows/Linux) 或 F5
    const isRefreshKey = (
      (input.key === 'r' && (input.meta || input.control)) ||
      input.key === 'F5'
    );
    
    // 检测开发者工具快捷键
    const isDevToolsKey = (
      (input.key === 'i' && input.meta && input.alt) || // macOS: Cmd+Option+I
      (input.key === 'i' && input.control && input.shift) || // Windows: Ctrl+Shift+I
      input.key === 'F12'
    );
    
    // 强制更新/维护模式下阻止操作
    if (isForceUpdateActive || isMaintenanceModeActive || isApiUnavailable) {
      if (isRefreshKey || isDevToolsKey) {
        event.preventDefault();
        console.log('已阻止操作:', isRefreshKey ? '刷新' : '开发者工具');
        mainWindow.webContents.send('show-force-update-warning');
      }
    } else {
      // 正常模式下允许刷新
      if (isRefreshKey && input.type === 'keyDown') {
        event.preventDefault();
        mainWindow.webContents.reload();
        console.log('页面已刷新 (Cmd/Ctrl+R)');
      }
    }
  });

  // 直接加载主界面
  mainWindow.loadFile('index.html').catch(err => {
    console.error('加载HTML失败:', err);
    dialog.showErrorBox('加载失败', '无法加载应用界面: ' + err.message);
  });
  
  // 仅显式传入 --dev 时打开开发工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}


// 初始化配置文件
async function initializeConfigFiles() {
  try {
    const userDataPath = app.getPath('userData');
    const configFile = path.join(userDataPath, 'windsurf-app-config.json');
    
    // 检查配置文件是否存在
    try {
      await fs.access(configFile);
      console.log(`Windsurf配置文件已存在: ${configFile}`);
    } catch (error) {
      // 文件不存在，创建默认配置
      console.log(` 创建默认Windsurf配置文件: ${configFile}`);
      
      // 默认配置
      const defaultConfig = {
        emailDomains: ['example.com'],
        emailConfig: null,
        workerUrl: '',
        lastUpdate: new Date().toISOString(),
        platform: process.platform
      };
      
      // 写入默认配置
      await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2));
      console.log(`默认Windsurf配置文件已创建`);
    }
    
    // 初始化其他必要的文件
    const accountsFile = path.join(userDataPath, 'accounts.json');
    try {
      await fs.access(accountsFile);
      console.log(`账号文件已存在: ${accountsFile}`);
      
      // 验证文件内容是否有效
      try {
        const data = await fs.readFile(accountsFile, 'utf-8');
        const accounts = JSON.parse(data);
        if (!Array.isArray(accounts)) {
          console.warn('账号文件格式错误，修复为空数组');
          await fs.writeFile(accountsFile, JSON.stringify([], null, 2));
        } else {
          console.log(`账号文件包含 ${accounts.length} 个账号`);
        }
      } catch (parseError) {
        console.warn('账号文件解析失败，修复为空数组');
        await fs.writeFile(accountsFile, JSON.stringify([], null, 2));
      }
    } catch (error) {
      // 创建空的账号文件（仅当文件不存在时）
      console.log(` 账号文件不存在，创建空文件: ${accountsFile}`);
      await fs.mkdir(path.dirname(accountsFile), { recursive: true });
      await fs.writeFile(accountsFile, JSON.stringify([], null, 2));
      console.log(`空的账号文件已创建`);
    }
  } catch (error) {
    console.error(`❗ 初始化配置文件失败:`, error);
  }
}

// 应用准备就绪时初始化配置并创建窗口
app.whenReady().then(async () => {
  await initializeConfigFiles();
  
  // 设置中文菜单（适配 macOS 和 Windows）
  const isMac = process.platform === 'darwin';
  
  const template = [
    // macOS 应用菜单
    ...(isMac ? [{
      label: 'Windsurf Tool',
      submenu: [
        { label: '关于 Windsurf Tool', role: 'about' },
        { type: 'separator' },
        { label: '隐藏 Windsurf Tool', role: 'hide', accelerator: 'Cmd+H' },
        { label: '隐藏其他', role: 'hideOthers', accelerator: 'Cmd+Option+H' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出 Windsurf Tool', role: 'quit', accelerator: 'Cmd+Q' }
      ]
    }] : []),
    // Windows 文件菜单
    ...(!isMac ? [{
      label: '文件',
      submenu: [
        { label: '退出', role: 'quit', accelerator: 'Alt+F4' }
      ]
    }] : []),
    // 编辑菜单（支持复制、粘贴、全选等快捷键）
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo', accelerator: isMac ? 'Cmd+Z' : 'Ctrl+Z' },
        { label: '重做', role: 'redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y' },
        { type: 'separator' },
        { label: '剪切', role: 'cut', accelerator: isMac ? 'Cmd+X' : 'Ctrl+X' },
        { label: '复制', role: 'copy', accelerator: isMac ? 'Cmd+C' : 'Ctrl+C' },
        { label: '粘贴', role: 'paste', accelerator: isMac ? 'Cmd+V' : 'Ctrl+V' },
        { label: '全选', role: 'selectAll', accelerator: isMac ? 'Cmd+A' : 'Ctrl+A' }
      ]
    },
    // 功能菜单
    {
      label: '功能',
      submenu: [
        {
          label: '检查更新',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('check-for-updates');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'QQ群',
          click: () => shell.openExternal('https://qm.qq.com/q/1W3jvnDoak')
        },
        {
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/crispvibe/Windsurf-Tool')
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  
  createWindow();
});

// 批量获取Token的取消标志
let batchTokenCancelled = false;

// 批量获取所有账号Token
ipcMain.handle('batch-get-all-tokens', async (event) => {
  try {
    console.log('[批量获取Token] 开始批量获取所有账号Token...');
    
    // 重置取消标志
    batchTokenCancelled = false;
    
    // 读取所有账号
    const accountsFilePath = path.normalize(ACCOUNTS_FILE);
    const accountsData = await fs.readFile(accountsFilePath, 'utf-8');
    const accounts = JSON.parse(accountsData);
    
    // 筛选出需要获取Token的账号（有邮箱密码，且Token不存在或已过期）
    const now = Date.now();
    const accountsNeedToken = [];
    const accountsSkipped = [];
    
    accounts.forEach(acc => {
      // 必须有邮箱和密码
      if (!acc.email || !acc.password) {
        return;
      }
      
      // 检查Token是否过期
      const tokenExpired = !acc.idToken || !acc.idTokenExpiresAt || now >= acc.idTokenExpiresAt;
      
      if (tokenExpired) {
        // Token过期或不存在,需要获取
        accountsNeedToken.push(acc);
        const reason = !acc.idToken ? 'Token不存在' : !acc.idTokenExpiresAt ? '缺少过期时间' : 'Token已过期';
        console.log(`[批量获取Token] ${acc.email} - ${reason}`);
      } else {
        // Token有效,跳过
        accountsSkipped.push(acc);
        const expiresIn = Math.round((acc.idTokenExpiresAt - now) / 1000 / 60);
        console.log(`[批量获取Token] ⊘ ${acc.email} - Token有效 (${expiresIn}分钟后过期)`);
      }
    });
    
    if (accountsNeedToken.length === 0) {
      return {
        success: false,
        error: `没有需要获取Token的账号（${accountsSkipped.length}个账号Token都有效）`
      };
    }
    
    console.log(`[批量获取Token] 需要获取: ${accountsNeedToken.length}个, 跳过: ${accountsSkipped.length}个`);
    
    const AccountLogin = require(path.join(__dirname, 'js', 'accountLogin'));
    const results = [];
    let successCount = 0;
    let failCount = 0;
    
    // 顺序处理每个账号
    for (let i = 0; i < accountsNeedToken.length; i++) {
      // 检查是否被取消
      if (batchTokenCancelled) {
        console.log('[批量获取Token] 用户取消操作');
        
        // 发送取消状态，让前端可以关闭弹窗
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('batch-token-complete', {
            total: accountsNeedToken.length,
            successCount,
            failCount,
            cancelled: true,
            results
          });
        }
        
        break;
      }
      
      const account = accountsNeedToken[i];
      
      // 发送进度更新
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch-token-progress', {
          current: i + 1,
          total: accountsNeedToken.length,
          email: account.email,
          status: 'processing'
        });
      }
      
      try {
        console.log(`[批量获取Token] [${i + 1}/${accountsNeedToken.length}] 处理账号: ${account.email}`);
        
        const loginBot = new AccountLogin();
        
        // 日志回调
        const logCallback = (message) => {
          console.log(`[批量获取Token] [${account.email}] ${message}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('batch-token-log', {
              email: account.email,
              message: message
            });
          }
        };
        
        // 获取Token
        const result = await loginBot.loginAndGetTokens(account, logCallback);
        
        if (result.success && result.account) {
          // 更新账号信息到文件
          const index = accounts.findIndex(acc => acc.id === account.id || acc.email === account.email);
          if (index !== -1) {
            // 只提取可序列化的字段，避免 V8 序列化崩溃
            const safeAccountData = {
              email: result.account.email || '',
              name: result.account.name || '',
              apiKey: result.account.apiKey || '',
              refreshToken: result.account.refreshToken || '',
              idToken: result.account.idToken || '',
              idTokenExpiresAt: result.account.idTokenExpiresAt || 0,
              apiServerUrl: result.account.apiServerUrl || ''
            };
            accounts[index] = {
              ...accounts[index],
              ...safeAccountData,
              id: accounts[index].id,
              createdAt: accounts[index].createdAt
            };
          }
          
          successCount++;
          results.push({
            email: account.email,
            success: true
          });
          
          // 发送成功状态
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('batch-token-progress', {
              current: i + 1,
              total: accountsNeedToken.length,
              email: account.email,
              status: 'success'
            });
          }
          
          console.log(`[批量获取Token] [${i + 1}/${accountsNeedToken.length}] 成功: ${account.email}`);
        } else {
          failCount++;
          results.push({
            email: account.email,
            success: false,
            error: result.error
          });
          
          // 发送失败状态
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('batch-token-progress', {
              current: i + 1,
              total: accountsNeedToken.length,
              email: account.email,
              status: 'failed',
              error: result.error
            });
          }
          
          console.log(`[批量获取Token] [${i + 1}/${accountsNeedToken.length}] 失败: ${account.email} - ${result.error}`);
        }
        
        // 每个账号之间延迟1秒，避免请求过快
        if (i < accountsNeedToken.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        failCount++;
        results.push({
          email: account.email,
          success: false,
          error: error.message
        });
        
        console.error(`[批量获取Token] [${i + 1}/${accountsNeedToken.length}] 异常: ${account.email}`, error);
        
        // 发送失败状态
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('batch-token-progress', {
            current: i + 1,
            total: accountsNeedToken.length,
            email: account.email,
            status: 'failed',
            error: error.message
          });
        }
      }
    }
    
    // 保存更新后的账号列表
    await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), 'utf-8');
    console.log(`[批量获取Token] 账号列表已更新到文件`);
    
    // 发送完成状态
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('batch-token-complete', {
        total: accountsNeedToken.length,
        successCount,
        failCount,
        results
      });
    }
    
    console.log(`[批量获取Token] 完成！成功: ${successCount}, 失败: ${failCount}, 取消: ${batchTokenCancelled}`);
    
    return {
      success: true,
      cancelled: batchTokenCancelled,
      total: accountsNeedToken.length,
      successCount,
      failCount,
      results
    };
    
  } catch (error) {
    console.error('[批量获取Token] 失败:', error);
    return {
      success: false,
      cancelled: batchTokenCancelled,
      error: error.message
    };
  }
});

// 取消批量获取Token
ipcMain.handle('cancel-batch-get-tokens', async () => {
  console.log('[批量获取Token] 收到取消请求');
  batchTokenCancelled = true;
  return { success: true };
});

// 监听退出应用请求
ipcMain.on('quit-app', () => {
  console.log('📢 收到退出应用请求');
  app.quit();
});

app.on('window-all-closed', () => {
  // 清理定时器
  if (versionCheckInterval) {
    clearInterval(versionCheckInterval);
  }
  
  // 清理所有 IPC 监听器
  ipcMain.removeAllListeners('check-version');
  ipcMain.removeAllListeners('set-force-update-status');
  ipcMain.removeAllListeners('quit-app');
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ==================== IPC 安全验证 ====================

function compareVersions(currentVersion, latestVersion) {
  const currentParts = String(currentVersion || '0.0.0').split('.').map(part => parseInt(part, 10) || 0);
  const latestParts = String(latestVersion || '0.0.0').split('.').map(part => parseInt(part, 10) || 0);
  const maxLength = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < maxLength; index++) {
    const currentPart = currentParts[index] || 0;
    const latestPart = latestParts[index] || 0;

    if (currentPart < latestPart) {
      return -1;
    }
    if (currentPart > latestPart) {
      return 1;
    }
  }

  return 0;
}

// IPC 操作验证函数
function isOperationAllowed(operation) {
  // 如果处于强制更新、维护模式或 API 无法访问状态，阻止大部分操作
  if (isForceUpdateActive || isMaintenanceModeActive || isApiUnavailable) {
    // 允许的操作白名单
    const allowedOperations = [
      'check-for-updates',
      'open-download-url',
      'get-file-paths'
    ];
    
    if (!allowedOperations.includes(operation)) {
      console.log(`操作被阻止: ${operation} (状态: 强制更新=${isForceUpdateActive}, 维护=${isMaintenanceModeActive}, API不可用=${isApiUnavailable})`);
      return false;
    }
  }
  return true;
}

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  const fallbackDownloadUrl = 'https://github.com/crispvibe/Windsurf-Tool/releases/latest';

  try {
    const axios = require('axios');
    const response = await axios.get(fallbackDownloadUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent': 'Windsurf-Tool'
      },
      timeout: 15000
    });

    const redirectLocation = response.headers?.location || '';
    const versionMatch = redirectLocation.match(/\/releases\/tag\/v?(\d+\.\d+\.\d+)/i);
    const latestVersion = versionMatch ? versionMatch[1] : currentVersion;
    const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;

    return {
      success: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      forceUpdate: false,
      isSupported: true,
      downloadUrl: redirectLocation || fallbackDownloadUrl,
      updateMessage: ''
    };
  } catch (error) {
    console.warn('检查版本更新失败:', error.message);
    return {
      success: false,
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      forceUpdate: false,
      isSupported: true,
      downloadUrl: fallbackDownloadUrl,
      error: error.message
    };
  }
});

ipcMain.handle('check-maintenance-mode', async () => {
  return {
    success: true,
    inMaintenance: isMaintenanceModeActive,
    maintenanceInfo: {
      enabled: isMaintenanceModeActive,
      message: isMaintenanceModeActive ? '服务器正在维护中，请稍后再试' : '',
      timestamp: new Date().toISOString()
    }
  };
});

ipcMain.handle('exit-maintenance-mode', async () => {
  isMaintenanceModeActive = false;
  isApiUnavailable = false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('maintenance-mode-ended');
  }

  return { success: true };
});

// ==================== 账号管理 ====================

// 读取账号列表（使用文件锁）
ipcMain.handle('get-accounts', async () => {
  return await accountsFileLock.acquire(async () => {
    try {
      // 确保目录存在
      await fs.mkdir(path.dirname(ACCOUNTS_FILE), { recursive: true });
      
      try {
        const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        const accounts = JSON.parse(data);
        console.log(`📖 读取账号列表: ${Array.isArray(accounts) ? accounts.length : 0} 个账号`);
        return { success: true, accounts: Array.isArray(accounts) ? accounts : [] };
      } catch (error) {
        console.error('读取账号文件失败:', error);
        return { success: true, accounts: [] };
      }
    } catch (error) {
      console.error('创建账号目录失败:', error);
      return { success: false, error: error.message };
    }
  });
});

// 读取账号列表（别名，用于兼容）
ipcMain.handle('load-accounts', async () => {
  try {
    // 确保目录存在
    await fs.mkdir(path.dirname(ACCOUNTS_FILE), { recursive: true });
    
    try {
      const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
      const accounts = JSON.parse(data);
      return { success: true, accounts: Array.isArray(accounts) ? accounts : [] };
    } catch (error) {
      console.error('读取账号文件失败:', error);
      return { success: true, accounts: [] };
    }
  } catch (error) {
    console.error('创建账号目录失败:', error);
    return { success: false, error: error.message };
  }
});

// 添加账号 - 跨平台兼容（使用文件锁）
ipcMain.handle('add-account', async (event, account) => {
  if (!isOperationAllowed('add-account')) {
    return { success: false, error: '当前状态下无法执行此操作' };
  }
  
  return await accountsFileLock.acquire(async () => {
    try {
      // 验证账号数据
      if (!account || !account.email || !account.password) {
        return { success: false, error: '账号数据不完整，缺少邮箱或密码' };
      }
      
      // 规范化路径（跨平台兼容）
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const accountsDir = path.dirname(accountsFilePath);
      
      // 确保目录存在
      await fs.mkdir(accountsDir, { recursive: true });
      console.log(`账号目录已准备: ${accountsDir}`);
      
      let accounts = [];
      try {
        const data = await fs.readFile(accountsFilePath, 'utf-8');
        accounts = JSON.parse(data);
        if (!Array.isArray(accounts)) {
          console.warn('账号文件格式错误，尝试从备份恢复');
          // 尝试从备份恢复
          try {
            const backupData = await fs.readFile(accountsFilePath + '.backup', 'utf-8');
            accounts = JSON.parse(backupData);
            console.log('已从备份恢复账号数据');
          } catch (backupError) {
            console.error('备份文件也损坏，重置为空数组');
            accounts = [];
          }
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          // 文件不存在，使用空数组
          console.log(' 账号文件不存在，将创建新文件');
        } else {
          // JSON解析失败，尝试从备份恢复
          console.error('账号文件损坏:', error.message);
          try {
            const backupData = await fs.readFile(accountsFilePath + '.backup', 'utf-8');
            accounts = JSON.parse(backupData);
            console.log('已从备份恢复账号数据');
          } catch (backupError) {
            console.error('无法恢复，使用空数组');
            accounts = [];
          }
        }
      }
      
      // 检查是否已存在相同邮箱（不区分大小写）
      const normalizedEmail = account.email.toLowerCase().trim();
      const existingAccount = accounts.find(acc => 
        acc.email && acc.email.toLowerCase().trim() === normalizedEmail
      );
      if (existingAccount) {
        return { success: false, error: `账号 ${account.email} 已存在` };
      }
      
      // 添加ID和创建时间
      account.id = Date.now().toString();
      account.createdAt = new Date().toISOString();
      accounts.push(account);
      
      // 先创建备份
      if (accounts.length > 0) {
        try {
          await fs.writeFile(accountsFilePath + '.backup', JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
        } catch (backupError) {
          console.warn('创建备份失败:', backupError.message);
        }
      }
      
      // 保存文件（使用 UTF-8 编码）
      await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
      console.log(`账号已添加: ${account.email} (总数: ${accounts.length})`);
      
      return { success: true, account };
    } catch (error) {
      console.error('添加账号失败:', error);
      return { success: false, error: `添加失败: ${error.message}` };
    }
  });
});

// 更新账号 - 跨平台兼容（使用文件锁）
ipcMain.handle('update-account', async (event, accountUpdate) => {
  return await accountsFileLock.acquire(async () => {
    try {
      // 规范化路径
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const accountsDir = path.dirname(accountsFilePath);
      
      // 确保目录存在
      await fs.mkdir(accountsDir, { recursive: true });
      
      try {
        const data = await fs.readFile(accountsFilePath, 'utf-8');
        let accounts = JSON.parse(data);
        
        if (!Array.isArray(accounts)) {
          return { success: false, error: '账号文件格式错误' };
        }
        
        // 检查账号是否存在
        const index = accounts.findIndex(acc => acc.id === accountUpdate.id);
        if (index === -1) {
          return { success: false, error: '账号不存在' };
        }
        
        // 更新账号属性
        accounts[index] = { ...accounts[index], ...accountUpdate, updatedAt: new Date().toISOString() };
        
        // 保存更新后的账号列表
        await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
        console.log(`账号已更新: ${accounts[index].email} (总数: ${accounts.length})`);
        
        return { 
          success: true, 
          message: '账号更新成功',
          account: accounts[index]
        };
      } catch (error) {
        console.error('读取账号文件失败:', error);
        return { success: false, error: `更新失败: ${error.message}` };
      }
    } catch (error) {
      console.error('更新账号失败:', error);
      return { success: false, error: `更新失败: ${error.message}` };
    }
  });
});

// 更新账号密码 - 仅修改本地保存的密码
ipcMain.handle('update-account-password', async (event, { accountId, newPassword }) => {
  return await accountsFileLock.acquire(async () => {
    try {
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const data = await fs.readFile(accountsFilePath, 'utf-8');
      let accounts = JSON.parse(data);
      
      if (!Array.isArray(accounts)) {
        return { success: false, error: '账号文件格式错误' };
      }
      
      const index = accounts.findIndex(acc => acc.id === accountId);
      if (index === -1) {
        return { success: false, error: '账号不存在' };
      }
      
      // 只更新密码字段
      accounts[index].password = newPassword;
      accounts[index].updatedAt = new Date().toISOString();
      
      await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
      console.log(`账号密码已更新: ${accounts[index].email}`);
      
      return { success: true, message: '密码修改成功' };
    } catch (error) {
      console.error('修改密码失败:', error);
      return { success: false, error: error.message };
    }
  });
});

// 更新账号备注
ipcMain.handle('update-account-note', async (event, accountId, note) => {
  return await accountsFileLock.acquire(async () => {
    try {
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const data = await fs.readFile(accountsFilePath, 'utf-8');
      let accounts = JSON.parse(data);
      
      if (!Array.isArray(accounts)) {
        return { success: false, error: '账号文件格式错误' };
      }
      
      const index = accounts.findIndex(acc => acc.id === accountId);
      if (index === -1) {
        return { success: false, error: '账号不存在' };
      }
      
      // 更新备注字段
      accounts[index].note = note;
      accounts[index].updatedAt = new Date().toISOString();
      
      await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
      console.log(`账号备注已更新: ${accounts[index].email} -> ${note || '(空)'}`);
      
      return { success: true, message: '备注保存成功' };
    } catch (error) {
      console.error('保存备注失败:', error);
      return { success: false, error: error.message };
    }
  });
});

// 删除账号 - 跨平台兼容（使用文件锁）
ipcMain.handle('delete-account', async (event, accountId) => {
  if (!isOperationAllowed('delete-account')) {
    return { success: false, error: '当前状态下无法执行此操作' };
  }
  
  return await accountsFileLock.acquire(async () => {
    try {
      // 规范化路径
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const accountsDir = path.dirname(accountsFilePath);
      
      // 确保目录存在
      await fs.mkdir(accountsDir, { recursive: true });
      
      try {
        const data = await fs.readFile(accountsFilePath, 'utf-8');
        let accounts = JSON.parse(data);
        
        if (!Array.isArray(accounts)) {
          return { success: false, error: '账号文件格式错误' };
        }
        
        // 检查账号是否存在
        const index = accounts.findIndex(acc => acc.id === accountId);
        if (index === -1) {
          return { success: false, error: '账号不存在' };
        }
        
        const deletedEmail = accounts[index].email;
        accounts.splice(index, 1);
        
        await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
        console.log(`账号已删除: ${deletedEmail} (剩余: ${accounts.length})`);
        
        return { success: true };
      } catch (error) {
        console.error('读取账号文件失败:', error);
        return { success: false, error: `删除失败: ${error.message}` };
      }
    } catch (error) {
      console.error('创建账号目录失败:', error);
      return { success: false, error: `删除失败: ${error.message}` };
    }
  });
});

// 删除全部账号 - 跨平台兼容（使用文件锁）
ipcMain.handle('delete-all-accounts', async () => {
  return await accountsFileLock.acquire(async () => {
    try {
      // 规范化路径
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const accountsDir = path.dirname(accountsFilePath);
      
      // 确保目录存在
      await fs.mkdir(accountsDir, { recursive: true });
      
      try {
        // 先读取当前账号数量（用于日志）
        let oldCount = 0;
        try {
          const data = await fs.readFile(accountsFilePath, 'utf-8');
          const accounts = JSON.parse(data);
          oldCount = Array.isArray(accounts) ? accounts.length : 0;
        } catch (e) {
          // 忽略读取错误
        }
        
        // 写入空数组
        await fs.writeFile(accountsFilePath, JSON.stringify([], null, 2), { encoding: 'utf-8' });
        console.log(`已删除全部账号 (共 ${oldCount} 个)`);
        return { success: true };
      } catch (error) {
        console.error('写入账号文件失败:', error);
        return { success: false, error: `删除失败: ${error.message}` };
      }
    } catch (error) {
      console.error('创建账号目录失败:', error);
      return { success: false, error: `删除失败: ${error.message}` };
    }
  });
});

// 刷新账号积分信息
ipcMain.handle('refresh-account-credits', async (event, account) => {
  try {
    console.log(`[刷新积分] 开始刷新账号 ${account.email} 的积分信息...`);
    
    // 使用 AccountQuery 模块获取真实的账号信息
    const AccountQuery = require(path.join(__dirname, 'js', 'accountQuery'));
    const CONSTANTS = require(path.join(__dirname, 'js', 'constants'));
    const axios = require('axios');
    
    // 检查是否有 refreshToken
    if (!account.refreshToken) {
      return {
        success: false,
        error: '账号缺少 refreshToken，无法刷新'
      };
    }
    
    let accessToken;
    let newTokenData = null;
    const now = Date.now();
    const tokenExpired = !account.idToken || !account.idTokenExpiresAt || now >= account.idTokenExpiresAt;
    
    // Step 1: 获取有效的 accessToken
    if (tokenExpired) {
      console.log(`[刷新积分] Token已过期，正在刷新...`);
      try {
        // 通过 Worker 刷新 Token
        const response = await axios.post(
          CONSTANTS.WORKER_URL,
          {
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken,
            api_key: CONSTANTS.FIREBASE_API_KEY
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              // 'X-Secret-Key': CONSTANTS.WORKER_SECRET_KEY  // 已禁用密钥验证
            },
            timeout: CONSTANTS.REQUEST_TIMEOUT
          }
        );
        
        accessToken = response.data.id_token;
        newTokenData = {
          idToken: response.data.id_token,
          idTokenExpiresAt: now + (parseInt(response.data.expires_in) * 1000),
          refreshToken: response.data.refresh_token
        };
        console.log(`[刷新积分] Token刷新成功`);
      } catch (tokenError) {
        console.error(`[刷新积分] Token刷新失败:`, tokenError.message);
        
        // 尝试使用邮箱密码重新登录
        if (account.email && account.password) {
          console.log(`[刷新积分] 尝试使用邮箱密码重新登录...`);
          const AccountLogin = require(path.join(__dirname, 'js', 'accountLogin'));
          const loginBot = new AccountLogin();
          
          const loginResult = await loginBot.loginAndGetTokens({ 
            email: account.email, 
            password: account.password 
          });
          
          if (loginResult.success && loginResult.account) {
            accessToken = loginResult.account.idToken;
            newTokenData = {
              idToken: loginResult.account.idToken,
              idTokenExpiresAt: loginResult.account.idTokenExpiresAt,
              refreshToken: loginResult.account.refreshToken,
              apiKey: loginResult.account.apiKey,
              name: loginResult.account.name,
              apiServerUrl: loginResult.account.apiServerUrl
            };
            console.log(`[刷新积分] 重新登录成功`);
          } else {
            throw new Error(loginResult.error || '重新登录失败');
          }
        } else {
          throw new Error(`Token刷新失败: ${tokenError.message}`);
        }
      }
    } else {
      accessToken = account.idToken;
      console.log(`[刷新积分] 使用本地Token`);
    }
    
    // Step 2: 查询账号使用情况
    console.log(`[刷新积分] 正在查询账号使用情况...`);
    const usageResponse = await axios.post(
      'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus',
      { auth_token: accessToken },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': accessToken,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-client-version': 'Chrome/JsCore/11.0.0/FirebaseCore-web'
        },
        timeout: CONSTANTS.REQUEST_TIMEOUT
      }
    );
    
    const planStatus = usageResponse.data.planStatus || usageResponse.data;
    const promptCredits = Math.round((planStatus.availablePromptCredits || 0) / 100);
    const flowCredits = Math.round((planStatus.availableFlowCredits || 0) / 100);
    const flexCredits = Math.round((planStatus.availableFlexCredits || 0) / 100);
    const totalCredits = promptCredits + flowCredits + flexCredits;
    // 修复：已使用积分需要计算所有4个字段
    const usedPromptCredits = Math.round((planStatus.usedPromptCredits || 0) / 100);
    // API 不直接返回 usedFlowCredits，需要通过 monthlyFlowCredits - availableFlowCredits 计算
    const monthlyFlowCredits = planStatus.planInfo?.monthlyFlowCredits || 0;
    const usedFlowCredits = Math.round(Math.max(0, monthlyFlowCredits - (planStatus.availableFlowCredits || 0)) / 100);
    const usedFlexCredits = Math.round((planStatus.usedFlexCredits || 0) / 100);
    const usedUsageCredits = Math.round((planStatus.usedUsageCredits || 0) / 100);
    const usedCredits = usedPromptCredits + usedFlowCredits + usedFlexCredits + usedUsageCredits;
    const usagePercentage = totalCredits > 0 ? Math.round((usedCredits / totalCredits) * 100) : 0;
    const planName = planStatus.planInfo?.planName || 'Free';
    const expiresAt = planStatus.planEnd || planStatus.expiresAt || null;
    
    console.log(`[刷新积分] 查询成功: ${planName}, 积分: ${totalCredits}, 使用率: ${usagePercentage}%`);
    
    // Step 3: 更新账号信息到 JSON 文件
    const updateData = {
      id: account.id,
      type: planName,
      credits: totalCredits,
      usedCredits: usedCredits,
      totalCredits: totalCredits,
      usage: usagePercentage,
      queryUpdatedAt: new Date().toISOString()
    };
    
    if (expiresAt) {
      updateData.expiresAt = expiresAt;
    }
    
    // 如果刷新了 Token，也保存
    if (newTokenData) {
      updateData.idToken = newTokenData.idToken;
      updateData.idTokenExpiresAt = newTokenData.idTokenExpiresAt;
      updateData.refreshToken = newTokenData.refreshToken;
      if (newTokenData.apiKey) updateData.apiKey = newTokenData.apiKey;
      if (newTokenData.name) updateData.name = newTokenData.name;
      if (newTokenData.apiServerUrl) updateData.apiServerUrl = newTokenData.apiServerUrl;
    }
    
    // 更新账号文件
    await accountsFileLock.acquire(async () => {
      const accountsFile = path.join(app.getPath('userData'), 'accounts.json');
      let accounts = [];
      try {
        const data = await fs.readFile(accountsFile, 'utf-8');
        accounts = JSON.parse(data);
      } catch (e) {
        console.error('[刷新积分] 读取账号文件失败:', e);
      }
      
      const index = accounts.findIndex(acc => acc.id === account.id || acc.email === account.email);
      if (index !== -1) {
        accounts[index] = { ...accounts[index], ...updateData, updatedAt: new Date().toISOString() };
        await fs.writeFile(accountsFile, JSON.stringify(accounts, null, 2), 'utf-8');
        console.log(`[刷新积分] 账号信息已保存到文件`);
      }
    });
    
    return {
      success: true,
      subscriptionType: planName,
      credits: totalCredits,
      usedCredits: usedCredits,
      usage: usagePercentage,
      expiresAt: expiresAt,
      message: '账号信息已刷新'
    };
  } catch (error) {
    console.error('刷新账号信息失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 复制到剪贴板
ipcMain.handle('copy-to-clipboard', async (event, text) => {
  try {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return {
      success: true
    };
  } catch (error) {
    console.error('复制到剪贴板失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});


// 打开下载链接
ipcMain.handle('open-download-url', async (event, downloadUrl) => {
  try {
    if (downloadUrl) {
      await shell.openExternal(downloadUrl);
      return { success: true };
    } else {
      // 如果没有下载链接，打开GitHub发布页面
      await shell.openExternal('https://github.com/crispvibe/Windsurf-Tool/releases/latest');
      return { success: true };
    }
  } catch (error) {
    console.error('打开下载链接失败:', error);
    return { success: false, error: error.message };
  }
});

// 打开外部URL（通用）
ipcMain.handle('open-external-url', async (event, url) => {
  try {
    if (url) {
      await shell.openExternal(url);
      return { success: true };
    } else {
      return { success: false, error: 'URL不能为空' };
    }
  } catch (error) {
    console.error('打开外部URL失败:', error);
    return { success: false, error: error.message };
  }
});

// 内部函数：获取单个账号的 plan 状态
async function checkSingleAccountPlan(account, accounts) {
  const axios = require('axios');
  const CONSTANTS = require('./js/constants');
  
  let token = account.idToken || account.apiKey;
  
  // 1. 尝试用 refreshToken 刷新
  if (account.refreshToken) {
    try {
      const refreshResp = await axios.post(
        `https://securetoken.googleapis.com/v1/token?key=${CONSTANTS.FIREBASE_API_KEY}`,
        `grant_type=refresh_token&refresh_token=${account.refreshToken}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
      token = refreshResp.data.id_token || refreshResp.data.access_token;
      if (refreshResp.data.refresh_token) account.refreshToken = refreshResp.data.refresh_token;
    } catch (e) {}
  }
  
  // 2. 没有 token → 用邮箱密码登录获取
  if (!token && account.email && account.password) {
    try {
      const loginResp = await axios.post(
        `${CONSTANTS.WORKER_URL}/login`,
        { email: account.email, password: account.password, api_key: CONSTANTS.FIREBASE_API_KEY },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      token = loginResp.data.idToken;
      if (loginResp.data.refreshToken) account.refreshToken = loginResp.data.refreshToken;
      if (loginResp.data.idToken) {
        account.idToken = loginResp.data.idToken;
        account.idTokenExpiresAt = Date.now() + (parseInt(loginResp.data.expiresIn || 3600) * 1000);
      }
    } catch (e) {
      return { success: false, error: `登录失败: ${e.message}` };
    }
  }
  
  if (!token) return { success: false, error: '无法获取 Token' };
  
  // 3. 查询 plan
  try {
    const resp = await axios.post(
      'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus',
      { auth_token: token },
      {
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token, 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      }
    );
    const planStatus = resp.data.planStatus || resp.data;
    const planName = planStatus.planInfo?.planName || 'Free';
    const expiresAt = planStatus.planEnd || planStatus.expiresAt || null;
    
    // 更新本地数据
    account.type = planName;
    if (expiresAt) account.expiresAt = expiresAt;
    
    return { success: true, planName, expiresAt };
  } catch (e) {
    return { success: false, error: `查询失败: ${e.message}` };
  }
}

// 检测单个账号订阅状态
ipcMain.handle('check-account-plan', async (event, request = {}) => {
  try {
    const accountId = request.accountId;
    const accountsData = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
    const accounts = JSON.parse(accountsData);
    const account = accounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: '未找到账号' };
    
    // 如果不强制刷新且本地已有 type 信息且不是 Free/空/-, 直接返回
    if (!request.force) {
      const localType = (account.type || '').toLowerCase();
      if (localType && localType !== 'free' && localType !== '-' && localType !== '') {
        return { success: true, planName: account.type, expiresAt: account.expiresAt || null };
      }
    }
    
    const result = await checkSingleAccountPlan(account, accounts);
    
    // 保存更新
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    console.log(`[检测] ${account.email} → ${result.planName || '失败'}`);
    return result;
  } catch (error) {
    console.error('[检测] 失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 批量检测所有账号订阅状态
ipcMain.handle('batch-check-plans', async (event) => {
  try {
    const accountsData = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
    const accounts = JSON.parse(accountsData);
    const results = [];
    
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (!acc || !acc.email) continue;
      
      // 发送进度
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch-check-progress', { current: i + 1, total: accounts.length, email: acc.email });
      }
      
      const result = await checkSingleAccountPlan(acc, accounts);
      results.push({ email: acc.email, ...result });
      console.log(`[批量检测] ${i + 1}/${accounts.length} ${acc.email} → ${result.planName || result.error}`);
      
      // 延迟避免频率限制
      if (i < accounts.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }
    
    // 保存所有更新
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    
    // 统计
    const trialCount = results.filter(r => r.planName && r.planName.toLowerCase().includes('trial')).length;
    const proCount = results.filter(r => r.planName && r.planName.toLowerCase().includes('pro')).length;
    const freeCount = results.filter(r => r.planName && r.planName.toLowerCase() === 'free').length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log(`[批量检测] 完成: Trial=${trialCount}, Pro=${proCount}, Free=${freeCount}, 失败=${failCount}`);
    return { success: true, results, summary: { trial: trialCount, pro: proCount, free: freeCount, failed: failCount } };
  } catch (error) {
    console.error('[批量检测] 失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 获取绑卡/支付链接
ipcMain.handle('get-payment-link', async (event, request = {}) => {
  const axios = require('axios');
  const CONSTANTS = require('./js/constants');

  // 自动检测系统代理并创建 agent
  let httpsAgent = undefined;
  let proxyUrl = '';
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    // 优先使用环境变量
    proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';
    // 如果没有环境变量，尝试从 Windows 注册表读取系统代理
    if (!proxyUrl) {
      try {
        const { execSync } = require('child_process');
        const regOutput = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable', { encoding: 'utf-8', timeout: 3000 });
        if (regOutput.includes('0x1')) {
          const serverOutput = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer', { encoding: 'utf-8', timeout: 3000 });
          const match = serverOutput.match(/ProxyServer\s+REG_SZ\s+(.+)/);
          if (match && match[1].trim()) {
            const server = match[1].trim();
            proxyUrl = server.startsWith('http') ? server : `http://${server}`;
          }
        }
      } catch (regErr) {}
    }
    if (proxyUrl) {
      httpsAgent = new HttpsProxyAgent(proxyUrl, { keepAlive: false, rejectUnauthorized: false });
      console.log(`[绑卡链接] 使用代理: ${proxyUrl}`);
    }
  } catch (proxyErr) {
    console.warn('[绑卡链接] 代理检测失败，直连:', proxyErr.message);
  }

  // 创建直连实例
  const httpDirect = axios.create({ timeout: 30000 });

  // 带重试的代理请求函数（处理代理 TLS 不稳定）
  async function proxyPost(url, data, config = {}) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 每次请求创建新的 agent，避免连接复用问题
        let agent = null;
        if (proxyUrl) {
          const { HttpsProxyAgent: Agent } = require('https-proxy-agent');
          agent = new Agent(proxyUrl, { keepAlive: false, rejectUnauthorized: false });
        }
        const response = await axios.post(url, data, {
          timeout: 30000,
          ...(agent ? { httpsAgent: agent, proxy: false } : {}),
          ...config
        });
        return response;
      } catch (error) {
        const isRetryable = error.code === 'ECONNRESET' || error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' || (error.message && error.message.includes('TLS'));
        if (isRetryable && attempt < maxRetries) {
          console.log(`[绑卡链接] 代理请求失败 (${error.code || error.message})，重试 ${attempt}/${maxRetries}...`);
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw error;
      }
    }
  }

  const accountId = typeof request.accountId === 'string' ? request.accountId.trim() : '';
  let email = typeof request.email === 'string' ? request.email.trim() : '';
  let password = typeof request.password === 'string' ? request.password : '';
  
  // 使用现有中转服务的 /login 路径
  const AUTH1_PASSWORD_LOGIN_URL = 'https://windsurf.com/_devin-auth/password/login';
  const FIREBASE_LOGIN_URL = CONSTANTS.WORKER_URL + '/login';
  const WINDSURF_API_BASE = 'https://web-backend.windsurf.com';
  const WINDSURF_POST_AUTH_URL = `${WINDSURF_API_BASE}/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth`;
  const PRICE_ID = 'price_1NuJObFKuRRGjKOFJVUbaIsJ';
  const SUCCESS_URL = 'https://windsurf.com/billing/payment-success?plan_tier=pro';
  const CANCEL_URL = 'https://windsurf.com/plan?plan_cancelled=true&plan_tier=pro';

  async function resolveAccountCredentials() {
    if (!accountId) {
      return;
    }

    const matchedAccount = await accountsFileLock.acquire(async () => {
      try {
        await fs.mkdir(path.dirname(ACCOUNTS_FILE), { recursive: true });
        const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        const accounts = JSON.parse(data);

        if (!Array.isArray(accounts)) {
          return null;
        }

        return accounts.find(acc => acc.id === accountId) || null;
      } catch (error) {
        console.error('[绑卡链接] 读取账号凭据失败:', error);
        return null;
      }
    });

    if (!matchedAccount) {
      throw new Error('所选账号不存在或列表已过期，请刷新账号列表后重试');
    }

    email = typeof matchedAccount.email === 'string' ? matchedAccount.email.trim() : '';
    password = typeof matchedAccount.password === 'string' ? matchedAccount.password : '';
  }
  
  // Protobuf 编码函数
  function encodeVarint(value) {
    const result = [];
    while (value > 0x7f) {
      result.push((value & 0x7f) | 0x80);
      value = value >>> 7;
    }
    result.push(value & 0x7f);
    return Buffer.from(result);
  }
  
  function encodeStringField(fieldNumber, value) {
    const tag = (fieldNumber << 3) | 2;
    const data = Buffer.from(value, 'utf-8');
    return Buffer.concat([Buffer.from([tag]), encodeVarint(data.length), data]);
  }
  
  function encodeVarintField(fieldNumber, value) {
    const tag = (fieldNumber << 3) | 0;
    return Buffer.concat([Buffer.from([tag]), encodeVarint(value)]);
  }

  function decodeVarint(buffer, offset) {
    let value = 0;
    let shift = 0;
    let index = offset;

    while (index < buffer.length) {
      const byte = buffer[index++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return { value, nextOffset: index };
      }
      shift += 7;
    }

    throw new Error('无效的 protobuf varint 数据');
  }

  function parseWindsurfPostAuthOrg(buffer) {
    const org = {
      id: '',
      name: '',
      isAdmin: false,
      canUseCli: false,
      canUseCascade: false
    };

    let offset = 0;
    while (offset < buffer.length) {
      const { value: tag, nextOffset: afterTag } = decodeVarint(buffer, offset);
      offset = afterTag;
      const fieldNumber = tag >> 3;
      const wireType = tag & 7;

      if (wireType === 2) {
        const { value: length, nextOffset: afterLength } = decodeVarint(buffer, offset);
        const valueBuffer = buffer.slice(afterLength, afterLength + length);
        offset = afterLength + length;
        const text = valueBuffer.toString('utf-8');

        if (fieldNumber === 1) {
          org.id = text;
        } else if (fieldNumber === 2) {
          org.name = text;
        }
      } else if (wireType === 0) {
        const { value, nextOffset } = decodeVarint(buffer, offset);
        offset = nextOffset;

        if (fieldNumber === 3) {
          org.isAdmin = value !== 0;
        } else if (fieldNumber === 4) {
          org.canUseCli = value !== 0;
        } else if (fieldNumber === 5) {
          org.canUseCascade = value !== 0;
        }
      } else {
        throw new Error(`WindsurfPostAuthOrg 存在不支持的 wire type: ${wireType}`);
      }
    }

    return org;
  }

  function parseWindsurfPostAuthResponse(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const result = {
      sessionToken: '',
      orgs: [],
      auth1Token: '',
      accountId: '',
      primaryOrgId: ''
    };

    let offset = 0;
    while (offset < buffer.length) {
      const { value: tag, nextOffset: afterTag } = decodeVarint(buffer, offset);
      offset = afterTag;
      const fieldNumber = tag >> 3;
      const wireType = tag & 7;

      if (wireType !== 2) {
        if (wireType === 0) {
          offset = decodeVarint(buffer, offset).nextOffset;
          continue;
        }
        throw new Error(`WindsurfPostAuthResponse 存在不支持的 wire type: ${wireType}`);
      }

      const { value: length, nextOffset: afterLength } = decodeVarint(buffer, offset);
      const valueBuffer = buffer.slice(afterLength, afterLength + length);
      offset = afterLength + length;

      if (fieldNumber === 1) {
        result.sessionToken = valueBuffer.toString('utf-8');
      } else if (fieldNumber === 2) {
        result.orgs.push(parseWindsurfPostAuthOrg(valueBuffer));
      } else if (fieldNumber === 3) {
        result.auth1Token = valueBuffer.toString('utf-8');
      } else if (fieldNumber === 4) {
        result.accountId = valueBuffer.toString('utf-8');
      } else if (fieldNumber === 5) {
        result.primaryOrgId = valueBuffer.toString('utf-8');
      }
    }

    return result;
  }

  function extractServiceErrorMessage(data) {
    if (!data) {
      return '';
    }

    if (Buffer.isBuffer(data)) {
      data = data.toString('utf-8');
    } else if (data instanceof ArrayBuffer) {
      data = Buffer.from(data).toString('utf-8');
    }

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return data;
      }
    }

    if (typeof data === 'object') {
      if (typeof data.error === 'string') {
        return data.error;
      }
      if (typeof data.error?.message === 'string') {
        return data.error.message;
      }
      if (typeof data.message === 'string') {
        return data.message;
      }
    }

    return '';
  }

  function mapFirebaseLoginError(message) {
    if (!message) {
      return '';
    }

    if (message.includes('EMAIL_NOT_FOUND')) {
      return '邮箱不存在，请检查邮箱地址是否正确';
    }
    if (message.includes('Invalid email or password') || message.includes('No account found')) {
      return '邮箱或密码错误，请检查账号凭据是否正确';
    }
    if (message.includes('INVALID_PASSWORD') || message.includes('INVALID_LOGIN_CREDENTIALS')) {
      return '邮箱或密码错误，请检查账号凭据是否正确';
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

    return '';
  }

  function shouldFallbackToFirebase(error) {
    const message = extractServiceErrorMessage(error.response?.data) || error.message || '';

    if (message.includes('多个组织')) {
      return false;
    }

    return (
      error.response?.status === 400 ||
      error.response?.status === 401 ||
      message.includes('Invalid email or password') ||
      message.includes('No account found') ||
      message.includes('账号凭据')
    );
  }

  async function loginWithAuth1Bridge() {
    const auth1LoginResponse = await httpDirect.post(AUTH1_PASSWORD_LOGIN_URL, {
      email,
      password
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const auth1Token = auth1LoginResponse.data?.token;
    if (!auth1Token) {
      throw new Error('Auth1 登录未返回 token');
    }

    const postAuthResponse = await proxyPost(
      WINDSURF_POST_AUTH_URL,
      Buffer.concat([
        encodeStringField(1, auth1Token),
        encodeStringField(2, '')
      ]),
      {
        headers: {
          'Content-Type': 'application/proto',
          'connect-protocol-version': '1',
          'Origin': 'https://windsurf.com'
        },
        timeout: 30000,
        responseType: 'arraybuffer'
      }
    );

    const bridgeResult = parseWindsurfPostAuthResponse(postAuthResponse.data);
    if (bridgeResult.orgs.length > 0 && !bridgeResult.sessionToken) {
      throw new Error('该账号关联多个组织，当前工具暂不支持自动选择组织');
    }
    if (!bridgeResult.sessionToken) {
      throw new Error('Auth1 桥接未返回会话 token');
    }

    return {
      token: bridgeResult.sessionToken,
      mode: 'auth1',
      auth1Token: bridgeResult.auth1Token || auth1Token,
      accountId: bridgeResult.accountId || '',
      primaryOrgId: bridgeResult.primaryOrgId || '',
      sessionToken: bridgeResult.sessionToken
    };
  }

  async function loginWithFirebase() {
    const loginResponse = await proxyPost(FIREBASE_LOGIN_URL, {
      email,
      password,
      api_key: CONSTANTS.FIREBASE_API_KEY,
      returnSecureToken: true
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    if (loginResponse.status !== 200 || !loginResponse.data.idToken) {
      throw new Error('登录失败，请检查账号密码');
    }

    return {
      token: loginResponse.data.idToken,
      mode: 'firebase',
      sessionToken: '',
      auth1Token: '',
      accountId: '',
      primaryOrgId: ''
    };
  }

  async function getSeatManagementAuthToken() {
    try {
      return await loginWithAuth1Bridge();
    } catch (error) {
      if (!shouldFallbackToFirebase(error)) {
        throw error;
      }

      const auth1Error = extractServiceErrorMessage(error.response?.data) || error.message || '';
      console.warn(`[绑卡链接] Auth1 登录失败，尝试 Firebase 回退: ${auth1Error}`);
      return await loginWithFirebase();
    }
  }

  function buildSeatManagementHeaders(loginResult) {
    const headers = {
      'Content-Type': 'application/proto',
      'connect-protocol-version': '1',
      'Origin': 'https://windsurf.com',
      'Authorization': `Bearer ${loginResult.token}`
    };

    if (loginResult.mode === 'auth1') {
      headers['X-Devin-Auth1-Token'] = loginResult.auth1Token;
      headers['X-Devin-Session-Token'] = loginResult.sessionToken || loginResult.token;

      if (loginResult.accountId) {
        headers['X-Devin-Account-Id'] = loginResult.accountId;
      }

      if (loginResult.primaryOrgId) {
        headers['X-Devin-Primary-Org-Id'] = loginResult.primaryOrgId;
      }
    }

    return headers;
  }
  
  let linkBrowser = null;
  
  try {
    await resolveAccountCredentials();

    if (!email || !password) {
      return { success: false, error: '所选账号缺少邮箱或密码' };
    }

    console.log(`[绑卡链接] 通过浏览器获取 ${email} 的试用链接...`);
    
    const sendLog = (msg) => {
      console.log(msg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auto-fill-log', msg);
      }
    };
    
    const os = require('os');
    const fsSync = require('fs');
    
    // 加载 puppeteer-real-browser（自动过 Turnstile）
    let prbConnect;
    try {
      const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
      const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'puppeteer-real-browser');
      if (fsSync.existsSync(unpackedPath)) {
        prbConnect = require(unpackedPath).connect;
      } else {
        prbConnect = require('puppeteer-real-browser').connect;
      }
    } catch (e) {
      return { success: false, error: '未安装 puppeteer-real-browser' };
    }
    
    let chromePath = null;
    const platform = os.platform();
    if (platform === 'win32') {
      chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      ].find(p => fsSync.existsSync(p));
    } else if (platform === 'darwin') {
      chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
      ].find(p => fsSync.existsSync(p));
    } else {
      chromePath = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'
      ].find(p => fsSync.existsSync(p));
    }
    
    sendLog('[绑卡链接] 启动浏览器...');
    const uniqueId = `bindcard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const userDataDir = path.join(os.tmpdir(), 'windsurf-tool-chrome', uniqueId);
    
    const connectOptions = {
      headless: false,
      fingerprint: true,
      turnstile: true,
      tf: true,
      timeout: 120000,
      userDataDir,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--no-first-run', '--window-size=1280,900', '--window-position=-32000,-32000']
    };
    if (chromePath) connectOptions.executablePath = chromePath;
    
    const { browser: realBrowser, page } = await prbConnect(connectOptions);
    linkBrowser = realBrowser;
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    // ===== 设置网络拦截 =====
    let capturedStripeUrl = null;
    
    page.on('response', async (resp) => {
      try {
        const u = resp.url();
        if (u.includes('SubscribeToPlan') || u.includes('subscribe')) {
          const text = (await resp.buffer()).toString('utf-8');
          if (text.includes('https://checkout.stripe.com')) {
            const s = text.indexOf('https://checkout.stripe.com');
            let e = s;
            while (e < text.length && text.charCodeAt(e) >= 32 && !' \n\r\t'.includes(text[e])) e++;
            capturedStripeUrl = text.substring(s, e);
            sendLog('[绑卡链接] ✓ 捕获Stripe链接(API)');
          }
        }
      } catch (e) {}
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().includes('checkout.stripe.com') && !capturedStripeUrl) {
        capturedStripeUrl = frame.url();
        sendLog('[绑卡链接] ✓ 捕获Stripe链接(跳转)');
      }
    });
    
    // 通用：关闭 Cookie 弹窗
    async function dismissCookies() {
      await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          const t = (b.textContent || '').trim();
          if (t === 'Accept all' || t === 'Reject all' || t === '接受所有') { b.click(); return; }
        }
      }).catch(() => {});
    }
    
    // 通用：React 输入框填值
    async function reactType(selector, value) {
      await page.evaluate((sel, val) => {
        const input = document.querySelector(sel);
        if (!input) return;
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector, value);
      const el = await page.$(selector);
      if (el) { await el.click({ clickCount: 3 }); await delay(50); await el.type(value, { delay: 10 }); }
    }
    
    // 通用：坐标点击按钮（先滚动到可见区域）
    async function clickBtn(textMatch) {
      const pos = await page.evaluate((match) => {
        for (const b of document.querySelectorAll('button, a, [role="button"]')) {
          const t = (b.textContent || '').trim();
          if (t.includes(match)) {
            b.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = b.getBoundingClientRect();
            if (r.width > 30 && r.height > 10) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2, t };
            }
          }
        }
        return null;
      }, textMatch).catch(() => null);
      if (pos) {
        await delay(200);
        await page.mouse.click(pos.x, pos.y);
        return pos.t;
      }
      return null;
    }
    
    // ===== 步骤1: 打开登录页 =====
    sendLog('[绑卡链接] 步骤1: 打开登录页...');
    await page.goto('https://windsurf.com/account/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(1500);
    await dismissCookies();
    await delay(300);
    
    // ===== 步骤2: 自动登录 =====
    sendLog('[绑卡链接] 步骤2: 登录...');
    try {
      await page.waitForSelector('input[type="email"], input[placeholder*="example"]', { timeout: 5000 });
      await reactType('input[type="email"], input[placeholder*="example"]', email);
      sendLog('[绑卡链接] ✓ 邮箱');
    } catch (e) { sendLog('[绑卡链接] ✗ 邮箱: ' + e.message); }
    await delay(300);
    
    let r = await clickBtn('Continue');
    sendLog('[绑卡链接] ✓ Continue' + (r ? `: ${r}` : ''));
    await delay(2000);
    
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await reactType('input[type="password"]', password);
      sendLog('[绑卡链接] ✓ 密码');
    } catch (e) { sendLog('[绑卡链接] ✗ 密码: ' + e.message); }
    await delay(300);
    
    r = await clickBtn('Log in') || await clickBtn('Sign in') || await clickBtn('Continue');
    sendLog('[绑卡链接] ✓ 登录提交');
    await delay(4000);
    
    // ===== 步骤3: 登录后点 Upgrade to Pro =====
    sendLog('[绑卡链接] 步骤3: 查找 Upgrade...');
    let upgraded = false;
    for (let i = 0; i < 10; i++) {
      const url = page.url();
      if (url.includes('checkout.stripe.com')) { capturedStripeUrl = url; break; }
      
      const upg = await clickBtn('Upgrade to Pro');
      if (upg) {
        sendLog(`[绑卡链接] ✓ 点击: ${upg}`);
        upgraded = true;
        await delay(2000);
        break;
      }
      // 也尝试直接导航到 pricing
      if (i === 5 && !upgraded) {
        sendLog('[绑卡链接] Upgrade 未找到，导航到 pricing...');
        await page.goto('https://windsurf.com/pricing', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await delay(1500);
        const trial = await clickBtn('Start Free Trial');
        if (trial) { sendLog('[绑卡链接] ✓ Start Free Trial'); await delay(2000); break; }
      }
      await delay(1000);
    }
    
    // ===== 步骤4: 等待 Start Free Trial / Captcha Continue / 重新登录 / Stripe =====
    sendLog('[绑卡链接] 步骤4: 等待...');
    let trialClicked = false;
    let reloginDone = false;
    
    for (let tick = 0; tick < 120; tick++) {
      await delay(500);
      if (capturedStripeUrl) break;
      
      const url = page.url();
      if (url.includes('checkout.stripe.com')) { capturedStripeUrl = url; break; }
      
      // 检测是否跳回登录页（Turnstile后重定向）→ 重新登录
      if (!reloginDone && (url.includes('/account/login') || url.includes('/login')) && trialClicked) {
        reloginDone = true;
        sendLog('[绑卡链接] 检测到重新登录页，自动登录...');
        await delay(1000);
        try {
          await page.waitForSelector('input[type="email"], input[placeholder*="example"]', { timeout: 5000 });
          await reactType('input[type="email"], input[placeholder*="example"]', email);
        } catch (e) {}
        await delay(300);
        await clickBtn('Continue');
        await delay(2000);
        try {
          await page.waitForSelector('input[type="password"]', { timeout: 5000 });
          await reactType('input[type="password"]', password);
        } catch (e) {}
        await delay(300);
        let loginR = await clickBtn('Log in');
        if (!loginR) loginR = await clickBtn('Sign in');
        if (!loginR) loginR = await clickBtn('Continue');
        sendLog('[绑卡链接] ✓ 重新登录提交');
        await delay(5000);
        continue;
      }
      
      // 优先：点 Start Free Trial
      if (!trialClicked) {
        const trial = await clickBtn('Start Free Trial');
        if (trial) {
          sendLog(`[绑卡链接] ✓ ${trial}`);
          trialClicked = true;
          await delay(1500);
          continue;
        }
      }
      
      // 点 Captcha 弹窗的 Continue
      const contPos = await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, a, [role="button"]')) {
          const t = (el.textContent || '').trim();
          const r = el.getBoundingClientRect();
          if (r.width > 50 && r.height > 20 && r.top > 0 && r.top < window.innerHeight) {
            if (t === 'Continue' && !t.includes('→')) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
        }
        return null;
      }).catch(() => null);
      
      if (contPos) {
        sendLog(`[绑卡链接] Continue(${Math.round(contPos.x)},${Math.round(contPos.y)}) → 点击`);
        await page.mouse.click(contPos.x, contPos.y);
        await delay(500);
        await page.mouse.click(contPos.x, contPos.y);
        await delay(500);
      }
      
      if (tick > 0 && tick % 20 === 0) {
        sendLog(`[绑卡链接] ${tick/2}s... ${url.substring(0, 50)}`);
      }
    }
    
    // 关闭后台浏览器
    try { await linkBrowser.close(); linkBrowser = null; } catch (e) {}
    
    if (!capturedStripeUrl) {
      return { success: false, error: '获取 Stripe 链接超时（60秒）' };
    }
    
    sendLog(`[绑卡链接] ✓ 成功获取试用链接`);
    console.log(`[绑卡链接] 链接: ${capturedStripeUrl.substring(0, 80)}...`);
    return { success: true, paymentLink: capturedStripeUrl };
    
  } catch (error) {
    console.error('[绑卡链接] 失败:', error.message);
    if (linkBrowser) { try { await linkBrowser.close(); } catch (e) {} }
    return { success: false, error: error.message };
  }
});

// 自动填写支付表单
ipcMain.handle('auto-fill-payment', async (event, { paymentLink, card, billing }) => {
  let browser = null;
  
  try {
    console.log('[自动填写] 开始自动填写支付表单...');
    
    const os = require('os');
    const fsSync = require('fs');
    
    let puppeteer;
    try {
      const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
      const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'rebrowser-puppeteer-core');
      if (fsSync.existsSync(unpackedPath)) {
        puppeteer = require(unpackedPath);
      } else {
        puppeteer = require('rebrowser-puppeteer-core');
      }
    } catch (e) {
      try {
        puppeteer = require('puppeteer-core');
      } catch (e2) {
        return { success: false, error: '未安装 puppeteer，请检查依赖是否完整' };
      }
    }
    const platform = os.platform();
    
    let chromePath = null;
    if (platform === 'darwin') {
      const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
      ];
      chromePath = possiblePaths.find(p => fsSync.existsSync(p));
    } else if (platform === 'win32') {
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      ];
      chromePath = possiblePaths.find(p => fsSync.existsSync(p));
    } else {
      const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
      ];
      chromePath = possiblePaths.find(p => fsSync.existsSync(p));
    }
    
    if (!chromePath) {
      return { success: false, error: '未找到 Chrome 浏览器，请确保已安装' };
    }
    
    console.log('[自动填写] Chrome 路径:', chromePath);
    
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--start-maximized'
      ]
    });
    
    const page = await browser.newPage();
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const sendLog = (msg) => {
      console.log(msg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auto-fill-log', msg);
      }
    };
    
    sendLog('[自动填写] 打开支付页面...');
    await page.goto(paymentLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    sendLog('[自动填写] 等待页面加载...');
    await delay(2000);
    
    sendLog('[自动填写] 等待支付表单...');
    try {
      await Promise.race([
        page.waitForSelector('button[data-testid="card-accordion-item-button"]', { timeout: 8000, visible: true }),
        page.waitForSelector('[data-testid="card-tab"]', { timeout: 8000, visible: true }),
        page.waitForSelector('input[type="radio"]', { timeout: 8000, visible: true }),
        page.waitForSelector('[class*="PaymentMethod"]', { timeout: 8000, visible: true }),
        page.waitForSelector('.TabLabel', { timeout: 8000, visible: true })
      ]);
      sendLog('[自动填写] 支付表单已加载');
    } catch (e) {
      sendLog('[自动填写] 等待超时，继续尝试...');
    }
    
    await delay(500);
    
    // ===== 选择支付宝 =====
    sendLog('[自动填写] 选择支付宝...');
    
    let alipayDone = false;
    
    // 方法1: 找"支付宝"精确文本节点位置，点击其左侧 radio
    try {
      const pos = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const t = walker.currentNode.textContent.trim();
          if (t === '支付宝' || t === 'Alipay') {
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const r = range.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              // 点击文本左侧约50px处（radio 按钮的位置）
              return { x: r.x - 30, y: r.y + r.height / 2, textX: r.x, textY: r.y };
            }
          }
        }
        return null;
      });
      if (pos) {
        // 先点 radio 区域
        await page.mouse.click(pos.x, pos.y);
        await delay(300);
        // 再点文本本身
        await page.mouse.click(pos.textX + 10, pos.textY + 8);
        sendLog(`[自动填写] ✓ 支付宝(文本坐标 ${Math.round(pos.textX)},${Math.round(pos.textY)})`);
        alipayDone = true;
      }
    } catch (e) {}
    
    await delay(500);
    
    // 方法2: 遍历 radio，找相邻文本含"支付宝"的那个
    if (!alipayDone) {
      try {
        const pos2 = await page.evaluate(() => {
          const radios = document.querySelectorAll('input[type="radio"]');
          for (const radio of radios) {
            // 检查同一容器内的文本
            const container = radio.closest('[class*="accordion"], [class*="Accordion"], label, li, div') || radio.parentElement;
            if (container) {
              const text = container.textContent || '';
              if (text.includes('支付宝') || text.includes('Alipay')) {
                if (!text.includes('银行卡') && !text.includes('Bank')) {
                  container.scrollIntoView({ block: 'center' });
                  const r = radio.getBoundingClientRect();
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
              }
            }
          }
          // 备用：第2个 radio
          if (radios.length >= 2) {
            const r = radios[1].getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
          return null;
        });
        if (pos2) {
          await page.mouse.click(pos2.x, pos2.y);
          sendLog('[自动填写] ✓ 支付宝(radio)');
          alipayDone = true;
        }
      } catch (e) {}
    }
    
    await delay(1500);
    
    // ===== 填写姓名 =====
    sendLog('[自动填写] 填写账单信息...');
    try {
      await page.evaluate((name) => {
        const input = document.querySelector('input[name="billingName"], input[placeholder*="Name"], input[placeholder*="姓名"]');
        if (input) {
          input.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, name);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, billing.name);
      const nameInput = await page.$('input[name="billingName"], input[placeholder*="Name"], input[placeholder*="姓名"]');
      if (nameInput) { await nameInput.click({ clickCount: 3 }); await delay(50); await nameInput.type(billing.name, { delay: 15 }); }
      sendLog('[自动填写] ✓ 姓名');
    } catch (e) {}
    
    // ===== 选择国家 =====
    try {
      await page.select('select[name="billingCountry"]', billing.country || 'CN');
      sendLog('[自动填写] ✓ 国家');
    } catch (e) {}
    await delay(800);
    
    // ===== 填写邮编 =====
    try {
      if (billing.postalCode) {
        const postInput = await page.$('input[name="billingPostalCode"], input[id="billingPostalCode"]');
        if (postInput) { await postInput.click({ clickCount: 3 }); await delay(50); await postInput.type(billing.postalCode, { delay: 15 }); sendLog('[自动填写] ✓ 邮编'); }
      }
    } catch (e) {}
    
    // ===== 选择省份 =====
    try {
      const prov = billing.province || billing.state;
      if (prov) {
        await page.select('select[id="billingAdministrativeArea"], select[name="billingAdministrativeArea"]', prov);
        sendLog('[自动填写] ✓ 省份');
      }
    } catch (e) {}
    await delay(300);
    
    // ===== 填写城市 =====
    try {
      if (billing.city) {
        const cityInput = await page.$('input[name="billingLocality"], input[id="billingLocality"]');
        if (cityInput) { await cityInput.click({ clickCount: 3 }); await delay(50); await cityInput.type(billing.city, { delay: 15 }); sendLog('[自动填写] ✓ 城市'); }
      }
    } catch (e) {}
    
    // ===== 填写地区 =====
    try {
      if (billing.district) {
        const distInput = await page.$('input[id="billingDependentLocality"], input[name="billingDependentLocality"]');
        if (distInput) { await distInput.click({ clickCount: 3 }); await delay(50); await distInput.type(billing.district, { delay: 15 }); }
      }
    } catch (e) {}
    
    // ===== 填写地址 =====
    try {
      if (billing.address) {
        const addrInput = await page.$('input[name="billingAddressLine1"], input[id="billingAddressLine1"]');
        if (addrInput) { await addrInput.click({ clickCount: 3 }); await delay(50); await addrInput.type(billing.address, { delay: 15 }); sendLog('[自动填写] ✓ 地址'); }
      }
    } catch (e) {}
    try {
      if (billing.address2) {
        const addr2Input = await page.$('input[id="billingAddressLine2"], input[name="billingAddressLine2"]');
        if (addr2Input) { await addr2Input.click({ clickCount: 3 }); await delay(50); await addr2Input.type(billing.address2, { delay: 15 }); }
      }
    } catch (e) {}
    
    // ===== 勾选同意条款 =====
    sendLog('[自动填写] 勾选条款...');
    await delay(300);
    try {
      await page.evaluate(() => {
        const cbs = document.querySelectorAll('input[type="checkbox"]');
        for (const cb of cbs) { if (!cb.checked) { cb.click(); return; } }
        const labels = document.querySelectorAll('label, div[role="checkbox"], span[role="checkbox"], [class*="Checkbox"]');
        for (const el of labels) {
          const text = (el.textContent || '').toLowerCase();
          if (text.includes('agree') || text.includes('terms') || text.includes('同意') || text.includes('条款')) { el.click(); return; }
        }
      });
      sendLog('[自动填写] ✓ 条款');
    } catch (e) {}
    
    // ===== 点击订阅 =====
    sendLog('[自动填写] 点击订阅...');
    await delay(500);
    try {
      const submitClicked = await page.evaluate(() => {
        // 优先用 submit 按钮
        for (const sel of ['button[type="submit"]', 'button[data-testid="hosted-payment-submit-button"]', 'button.SubmitButton', 'button[class*="Submit"]']) {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled) { btn.click(); return sel; }
        }
        // 文本匹配
        for (const btn of document.querySelectorAll('button, [role="button"]')) {
          const t = (btn.textContent || '').trim();
          if ((t.includes('订阅') || t.includes('Subscribe') || t.includes('Pay') || t.includes('Submit')) && !btn.disabled) {
            btn.click(); return 'text:' + t.substring(0, 20);
          }
        }
        return null;
      });
      if (submitClicked) sendLog(`[自动填写] ✓ 订阅: ${submitClicked}`);
      else sendLog('[自动填写] 未找到订阅按钮');
    } catch (e) {}
    
    sendLog('[自动填写] 填写完成，等待支付结果（最长3分钟，请扫码完成支付）...');
    
    try {
      await page.waitForNavigation({ timeout: 180000, waitUntil: 'domcontentloaded' });
      const finalUrl = page.url();
      if (finalUrl.includes('payment-success') || finalUrl.includes('success')) {
        sendLog('[自动填写] ✅ 支付成功！');
        return { success: true, message: '绑卡成功' };
      } else if (finalUrl.includes('cancelled') || finalUrl.includes('cancel')) {
        sendLog('[自动填写] ❌ 支付已取消');
        return { success: false, error: '支付已取消' };
      }
    } catch (e) {
      sendLog('[自动填写] 等待支付结果超时，请在浏览器中查看');
    }
    
    return { success: true };
    
  } catch (error) {
    console.error('[自动填写] 失败:', error.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    return { success: false, error: error.message };
  }
});


// ==================== 批量注册 ====================

// 批量注册账号
ipcMain.handle('batch-register', async (event, config) => {
  // 使用 JavaScript 版本注册机器人
  const RegistrationBot = require(path.join(__dirname, 'src', 'registrationBot'));
  console.log('使用 JavaScript 版本注册机器人');
  
  // 创建保存账号的回调函数
  const saveAccountCallback = async (account) => {
    return await accountsFileLock.acquire(async () => {
      try {
        // 验证账号数据
        if (!account || !account.email || !account.password) {
          return { success: false, error: '账号数据不完整，缺少邮箱或密码' };
        }
        
        // 规范化路径（跨平台兼容）
        const accountsFilePath = path.normalize(ACCOUNTS_FILE);
        const accountsDir = path.dirname(accountsFilePath);
        
        // 确保目录存在
        await fs.mkdir(accountsDir, { recursive: true });
        
        let accounts = [];
        try {
          const data = await fs.readFile(accountsFilePath, 'utf-8');
          accounts = JSON.parse(data);
          if (!Array.isArray(accounts)) {
            accounts = [];
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error('读取账号文件失败:', error.message);
          }
          accounts = [];
        }
        
        // 检查是否已存在相同邮箱
        const normalizedEmail = account.email.toLowerCase().trim();
        const existingAccount = accounts.find(acc => 
          acc.email && acc.email.toLowerCase().trim() === normalizedEmail
        );
        if (existingAccount) {
          return { success: false, error: `账号 ${account.email} 已存在` };
        }
        
        // 添加ID和创建时间
        account.id = Date.now().toString();
        account.createdAt = new Date().toISOString();
        accounts.push(account);
        
        // 先创建备份
        if (accounts.length > 0) {
          try {
            await fs.writeFile(accountsFilePath + '.backup', JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
          } catch (backupError) {
            console.warn('创建备份失败:', backupError.message);
          }
        }
        
        // 保存文件
        await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
        console.log(`账号已添加: ${account.email} (总数: ${accounts.length})`);
        
        return { success: true, account };
      } catch (error) {
        console.error('添加账号失败:', error);
        return { success: false, error: `添加失败: ${error.message}` };
      }
    });
  };
  
  const bot = new RegistrationBot(config, saveAccountCallback);
  currentRegistrationBot = bot;
  
  try {
    return await bot.batchRegister(config.count, config.threads || 4, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('registration-progress', progress);
      }
    }, (log) => {
      // 同时输出到控制台
      console.log(log);
      // 发送实时日志到前端
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('registration-log', { message: log, type: 'info' });
      }
    });
  } finally {
    currentRegistrationBot = null;
  }
});

// 取消批量注册（跨平台：mac / Windows / Linux）
ipcMain.handle('cancel-batch-register', async () => {
  try {
    const logCallback = (log) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('registration-log', log);
      }
    };

    // 使用统一的 BrowserKiller 工具关闭浏览器进程
    const BrowserKiller = require('./src/registrationBotCancel');
    await BrowserKiller.cancelBatchRegistration(currentRegistrationBot, logCallback);
    
    // 清空当前注册实例
    currentRegistrationBot = null;
    
    return {
      success: true,
      message: '批量注册已取消'
    };
  } catch (error) {
    console.error('取消批量注册失败:', error);
    return {
      success: false,
      message: error.message
    };
  }
});

// 获取当前登录信息（从 vscdb 读取）
ipcMain.handle('get-current-login', async () => {
  try {
    const { AccountSwitcher } = require(path.join(__dirname, 'js', 'accountSwitcher'));
    const account = await AccountSwitcher.getCurrentAccount();
    
    if (account) {
      return {
        success: true,
        email: account.email,
        name: account.name,
        apiKey: account.apiKey,
        planName: account.planName
      };
    }
    
    return { success: false };
  } catch (error) {
    console.error('获取当前登录信息失败:', error);
    return { success: false, error: error.message };
  }
});

// 测试IMAP连接
ipcMain.handle('test-imap', async (event, config) => {
  try {
    const EmailReceiver = require(path.join(__dirname, 'src', 'emailReceiver'));
    const receiver = new EmailReceiver(config);
    return await receiver.testConnection();
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// ==================== 账号切换 ====================

// 切换账号
ipcMain.handle('switch-account', async (event, account) => {
  if (!isOperationAllowed('switch-account')) {
    return { success: false, error: '当前状态下无法执行此操作' };
  }
  try {
    const { AccountSwitcher } = require(path.join(__dirname, 'js', 'accountSwitcher'));
    
    const result = await AccountSwitcher.switchAccount(account, (log) => {
      // 发送日志到渲染进程
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('switch-log', log);
      }
    });
    
    return result;
  } catch (error) {
    console.error('切换账号失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 获取当前 Windsurf 登录的账号
ipcMain.handle('get-current-windsurf-account', async () => {
  try {
    const CurrentAccountDetector = require(path.join(__dirname, 'js', 'currentAccountDetector'));
    const account = await CurrentAccountDetector.getCurrentAccount();
    return account;
  } catch (error) {
    console.error('获取当前 Windsurf 账号失败:', error);
    return null;
  }
});

// 获取配置文件路径
ipcMain.handle('get-config-path', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const configFile = path.join(userDataPath, 'windsurf-app-config.json');
    return { success: true, path: configFile };
  } catch (error) {
    console.error('获取配置路径失败:', error);
    return { success: false, error: error.message };
  }
});

function normalizeWindsurfConfig(rawConfig) {
  const knownKeys = [
    'emailDomains',
    'emailConfig',
    'passwordMode',
    'queryInterval',
    'workerUrl',
    'autoBindUsage',
    'autoBindCard',
    'lastUpdate',
    'platform'
  ];

  const mergedConfig = {};
  const visited = new Set();
  let current = rawConfig;

  while (current && typeof current === 'object' && !Array.isArray(current) && !visited.has(current)) {
    visited.add(current);

    for (const key of knownKeys) {
      if (current[key] !== undefined) {
        mergedConfig[key] = current[key];
      }
    }

    current = current.config && typeof current.config === 'object' && !Array.isArray(current.config)
      ? current.config
      : null;
  }

  return {
    emailDomains: Array.isArray(mergedConfig.emailDomains) ? mergedConfig.emailDomains : ['example.com'],
    emailConfig: mergedConfig.emailConfig && typeof mergedConfig.emailConfig === 'object' ? mergedConfig.emailConfig : null,
    passwordMode: typeof mergedConfig.passwordMode === 'string' ? mergedConfig.passwordMode : 'email',
    queryInterval: Number.isFinite(Number(mergedConfig.queryInterval)) ? Number(mergedConfig.queryInterval) : 5,
    workerUrl: typeof mergedConfig.workerUrl === 'string' ? mergedConfig.workerUrl.trim().replace(/\/+$/, '') : '',
    autoBindUsage: mergedConfig.autoBindUsage && typeof mergedConfig.autoBindUsage === 'object' ? mergedConfig.autoBindUsage : undefined,
    autoBindCard: mergedConfig.autoBindCard && typeof mergedConfig.autoBindCard === 'object' ? mergedConfig.autoBindCard : undefined,
    lastUpdate: typeof mergedConfig.lastUpdate === 'string' ? mergedConfig.lastUpdate : undefined,
    platform: typeof mergedConfig.platform === 'string' ? mergedConfig.platform : undefined
  };
}

// 保存Windsurf配置
ipcMain.handle('save-windsurf-config', async (event, config) => {
  try {
    const userDataPath = app.getPath('userData');
    const configFile = path.join(userDataPath, 'windsurf-app-config.json');
    const normalizedConfig = normalizeWindsurfConfig(config);
    
    // 确保目录存在
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    
    // 保存配置到文件
    await fs.writeFile(configFile, JSON.stringify(normalizedConfig, null, 2));
    
    console.log(`Windsurf配置已保存 (${process.platform}):`, configFile);
    return { success: true, message: '配置已保存' };
  } catch (error) {
    console.error(`保存Windsurf配置失败 (${process.platform}):`, error);
    return { success: false, error: error.message };
  }
});

// 读取Windsurf配置
ipcMain.handle('load-windsurf-config', async (event) => {
  try {
    const userDataPath = app.getPath('userData');
    const configFile = path.join(userDataPath, 'windsurf-app-config.json');
    
    try {
      const data = await fs.readFile(configFile, 'utf-8');
      const rawConfig = JSON.parse(data);
      const config = normalizeWindsurfConfig(rawConfig);
      console.log(`Windsurf配置已读取 (${process.platform}):`, configFile);
      if (JSON.stringify(rawConfig) !== JSON.stringify(config)) {
        await fs.writeFile(configFile, JSON.stringify(config, null, 2));
      }
      // 返回统一格式：{ success: true, config: ... }
      return { success: true, config };
    } catch (error) {
      // 文件不存在或解析失败，返回默认配置
      console.log(`  Windsurf配置文件不存在或无法读取 (${process.platform})，使用默认配置`);
      console.log(`   预期路径: ${configFile}`);
      return {
        success: true,
        config: {
          emailDomains: ['example.com'],
          emailConfig: null,
          passwordMode: 'email',
          workerUrl: ''
        }
      };
    }
  } catch (error) {
    console.error(`读取Windsurf配置失败 (${process.platform}):`, error);
    return { success: false, error: error.message };
  }
});

// ==================== Windsurf管理器 ====================

// 检测 Windsurf 是否正在运行
ipcMain.handle('check-windsurf-running', async () => {
  try {
    const { WindsurfPathDetector } = require(path.join(__dirname, 'js', 'accountSwitcher'));
    return await WindsurfPathDetector.isRunning();
  } catch (error) {
    console.error('检测 Windsurf 运行状态失败:', error);
    return false;
  }
});

// 关闭 Windsurf
ipcMain.handle('close-windsurf', async () => {
  try {
    const { WindsurfPathDetector } = require(path.join(__dirname, 'js', 'accountSwitcher'));
    await WindsurfPathDetector.closeWindsurf();
    return { success: true };
  } catch (error) {
    console.error('关闭 Windsurf 失败:', error);
    return { success: false, error: error.message };
  }
});


// ==================== 文件导出 ====================

// 保存文件对话框 - 用于导出功能
ipcMain.handle('save-file-dialog', async (event, options) => {
  try {
    const { content, title, defaultPath, filters } = options;
    
    // 显示保存对话框
    const result = await dialog.showSaveDialog(mainWindow, {
      title: title || '保存文件',
      defaultPath: defaultPath || path.join(app.getPath('documents'), 'export.txt'),
      filters: filters || [{ name: '所有文件', extensions: ['*'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    
    if (result.canceled) {
      return { success: false, cancelled: true };
    }
    
    // 写入文件
    const normalizedPath = path.normalize(result.filePath);
    const dir = path.dirname(normalizedPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(normalizedPath, content, { encoding: 'utf-8', flag: 'w' });
    
    console.log(`文件已保存: ${normalizedPath}`);
    
    return { 
      success: true, 
      filePath: normalizedPath
    };
  } catch (error) {
    console.error('保存文件失败:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
});

// 保存文件 - 跨平台兼容
ipcMain.handle('save-file', async (event, options) => {
  try {
    const { content, filename, filters } = options;
    
    // 规范化文件名，移除不合法字符
    const sanitizedFilename = filename.replace(/[<>:"\/\\|?*]/g, '_');
    
    // 设置默认保存路径（使用用户主目录）
    const defaultPath = path.join(
      app.getPath('documents'),
      sanitizedFilename
    );
    
    // 显示保存对话框
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath,
      filters: filters || [
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    
    if (result.canceled) {
      return { success: false, error: '用户取消了保存操作' };
    }
    
    // 规范化路径（跨平台兼容）
    const normalizedPath = path.normalize(result.filePath);
    
    // 确保目录存在
    const dir = path.dirname(normalizedPath);
    await fs.mkdir(dir, { recursive: true });
    
    // 写入文件（使用 UTF-8 编码，兼容 Windows 和 macOS）
    await fs.writeFile(normalizedPath, content, { encoding: 'utf-8', flag: 'w' });
    
    console.log(`文件已保存: ${normalizedPath}`);
    
    return { 
      success: true, 
      filePath: normalizedPath,
      message: '文件保存成功'
    };
  } catch (error) {
    console.error('保存文件失败:', error);
    return { 
      success: false, 
      error: `保存失败: ${error.message}` 
    };
  }
});

// ==================== Token获取 ====================

// 获取用户数据路径
ipcMain.handle('get-user-data-path', () => {
  try {
    return {
      success: true,
      path: app.getPath('userData')
    };
  } catch (error) {
    console.error('获取用户数据路径失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 获取配置文件和账号文件路径
ipcMain.handle('get-file-paths', () => {
  try {
    const userDataPath = app.getPath('userData');
    const configFile = path.join(userDataPath, 'windsurf-app-config.json');
    const accountsFile = path.join(userDataPath, 'accounts.json');
    
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
});

// 登录并获取 Token（用于导入的账号）
ipcMain.handle('login-and-get-tokens', async (event, account) => {
  try {
    const { email, password, id } = account;
    
    if (!email || !password) {
      return { success: false, error: '邮箱或密码不能为空' };
    }
    
    console.log(`[登录获取Token] 开始为账号 ${email} 获取 Token...`);
    
    // 使用 AccountLogin 模块
    const AccountLogin = require(path.join(__dirname, 'js', 'accountLogin'));
    const loginBot = new AccountLogin();
    
    // 日志回调函数（发送到渲染进程）
    const logCallback = (message) => {
      console.log(`[登录获取Token] ${message}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('login-log', message);
      }
    };
    
    // 执行登录并获取 Token
    const result = await loginBot.loginAndGetTokens(account, logCallback);
    
    if (result.success && result.account) {
      // 更新账号信息到 JSON 文件
      const accountsFilePath = path.normalize(ACCOUNTS_FILE);
      const accountsData = await fs.readFile(accountsFilePath, 'utf-8');
      const accounts = JSON.parse(accountsData);
      
      // 查找并更新账号
      const index = accounts.findIndex(acc => acc.id === id || acc.email === email);
      if (index !== -1) {
        // 保留原有的 id 和 createdAt
        accounts[index] = {
          ...accounts[index],
          ...result.account,
          id: accounts[index].id,
          createdAt: accounts[index].createdAt
        };
        
        // 保存到文件
        await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), 'utf-8');
        console.log(`[登录获取Token] 账号 ${email} 的 Token 已更新到文件`);
      }
    }
    
    return result;
  } catch (error) {
    console.error('[登录获取Token] 失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// 获取账号Token（统一使用AccountLogin模块）
ipcMain.handle('get-account-token', async (event, credentials) => {
  try {
    const { email, password } = credentials;
    
    if (!email || !password) {
      return { success: false, error: '邮箱或密码不能为空' };
    }
    
    console.log(`开始获取账号 ${email} 的token...`);
    console.log(`当前平台: ${process.platform}`);
    
    // 使用 AccountLogin 模块（统一的Token获取方案）
    const AccountLogin = require(path.join(__dirname, 'js', 'accountLogin'));
    const loginBot = new AccountLogin();
    
    // 日志回调函数
    const logCallback = (message) => {
      console.log(`[Token获取] ${message}`);
    };
    
    // 执行登录并获取 Token
    const result = await loginBot.loginAndGetTokens({ email, password }, logCallback);
    
    // 转换返回格式以兼容旧的调用方
    // 注意：只返回可序列化的纯数据，避免 V8 序列化崩溃
    if (result.success && result.account) {
      // 深拷贝并过滤非序列化字段，防止 IPC 序列化崩溃
      const safeAccount = JSON.parse(JSON.stringify({
        email: result.account.email || '',
        name: result.account.name || '',
        apiKey: result.account.apiKey || '',
        refreshToken: result.account.refreshToken || '',
        idToken: result.account.idToken || '',
        idTokenExpiresAt: result.account.idTokenExpiresAt || 0,
        apiServerUrl: result.account.apiServerUrl || ''
      }));
      
      return {
        success: true,
        token: safeAccount.apiKey,
        email: safeAccount.email,
        password: password,
        username: safeAccount.name,
        apiKey: safeAccount.apiKey,
        refreshToken: safeAccount.refreshToken,
        account: safeAccount
      };
    }
    
    return result;
  } catch (error) {
    console.error('获取token失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Windsurf 账号切换功能已移除

// 导出文件锁供其他模块使用
module.exports = {
  accountsFileLock
};
