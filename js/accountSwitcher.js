// accountSwitcher.js - Windsurf 账号切换模块
// 独立模块，支持跨平台（Windows/Mac/Linux）


const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Windsurf 路径检测器
 */
class WindsurfPathDetector {
  /**
   * 获取用户主目录（兼容 Electron 和 Node.js）
   */
  static getHomeDir() {
    try {
      // 尝试使用 Electron 的 app.getPath
      if (typeof app !== 'undefined' && app.getPath) {
        return app.getPath('home');
      }
    } catch (error) {
      // Electron 不可用
    }
    
    // 使用 Node.js 的 os.homedir()
    const os = require('os');
    return os.homedir();
  }
  
  /**
   * 获取 AppData 路径（兼容 Electron 和 Node.js）
   */
  static getAppDataDir() {
    try {
      // 尝试使用 Electron 的 app.getPath
      if (typeof app !== 'undefined' && app.getPath) {
        return app.getPath('appData');
      }
    } catch (error) {
      // Electron 不可用
    }
    
    // 使用 Node.js 方式
    const os = require('os');
    const homeDir = os.homedir();
    
    if (process.platform === 'win32') {
      return path.join(homeDir, 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
      return path.join(homeDir, 'Library', 'Application Support');
    } else {
      return path.join(homeDir, '.config');
    }
  }
  
  /**
   * 获取 Windsurf 数据库路径
   */
  static getDBPath() {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return path.join(this.getAppDataDir(), 'Windsurf/User/globalStorage/state.vscdb');
    } else if (platform === 'darwin') {
      return path.join(this.getHomeDir(), 'Library/Application Support/Windsurf/User/globalStorage/state.vscdb');
    }
    
    throw new Error(`不支持的平台: ${platform}`);
  }
  
  /**
   * 获取 Windsurf 用户数据目录
   */
  static getUserDataPath() {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return path.join(this.getAppDataDir(), 'Windsurf');
    } else if (platform === 'darwin') {
      return path.join(this.getHomeDir(), 'Library/Application Support/Windsurf');
    }
    
    throw new Error(`不支持的平台: ${platform}`);
  }
  
  /**
   * 获取 Local State 路径
   */
  static getLocalStatePath() {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return path.join(this.getAppDataDir(), 'Windsurf/Local State');
    } else if (platform === 'darwin') {
      return path.join(this.getHomeDir(), 'Library/Application Support/Windsurf/Local State');
    }
    
    throw new Error(`不支持的平台: ${platform}`);
  }
  
  /**
   * 获取 storage.json 路径
   */
  static getStorageJsonPath() {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return path.join(this.getAppDataDir(), 'Windsurf/User/globalStorage/storage.json');
    } else if (platform === 'darwin') {
      return path.join(this.getHomeDir(), 'Library/Application Support/Windsurf/User/globalStorage/storage.json');
    }
    
    throw new Error(`不支持的平台: ${platform}`);
  }
  
  /**
   * 检查 Windsurf 是否已安装
   */
  static async isInstalled() {
    try {
      const dbPath = this.getDBPath();
      await fs.access(dbPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 启动 Windsurf
   */
  static async startWindsurf() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      console.log('[启动 Windsurf] 开始启动...');
      
      if (process.platform === 'win32') {
        await this.startWindsurfWindows(execAsync);
      } else if (process.platform === 'darwin') {
        await this.startWindsurfMacOS(execAsync);
      } else {
        throw new Error('不支持的操作系统');
      }
      
      // 验证启动是否成功（等待最多 10 秒，Windows启动较慢）
      console.log('[启动 Windsurf] 验证启动状态...');
      const maxAttempts = process.platform === 'win32' ? 10 : 5;
      
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (await this.isRunning()) {
          console.log(`[启动 Windsurf] 启动成功并已验证 (耗时: ${i + 1}秒)`);
          return true;
        }
        console.log(`[启动 Windsurf] 等待启动... (${i + 1}/${maxAttempts})`);
      }
      
      console.warn('[启动 Windsurf] 无法验证启动状态，但命令已执行');
      console.warn('[启动 Windsurf] Windsurf 可能正在后台启动，请稍候');
      return true;
    } catch (error) {
      console.error('[启动 Windsurf] 错误:', error);
      throw error;
    }
  }
  
  /**
   * Windows: 启动 Windsurf
   */
  static async startWindsurfWindows(execAsync) {
    const os = require('os');
    const { spawn, execSync } = require('child_process');
    const homeDir = os.homedir();
    
    // 展开环境变量
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    
    // 可能的安装路径（按优先级排序）
    const possiblePaths = [];
    
    // 0. 优先使用缓存的路径（关闭 Windsurf 时保存的）
    if (this.cachedWindsurfPath) {
      possiblePaths.push(this.cachedWindsurfPath);
      console.log(`[启动 Windsurf] Windows: 使用缓存路径: ${this.cachedWindsurfPath}`);
    }
    
    // 1. 用户本地安装（最常见）
    possiblePaths.push(path.join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'));
    
    // 2. 尝试从正在运行的进程获取路径
    try {
      const result = execSync('wmic process where "name=\'Windsurf.exe\'" get ExecutablePath', { 
        encoding: 'utf-8',
        timeout: 3000
      });
      const lines = result.split('\n').filter(line => line.trim() && !line.includes('ExecutablePath'));
      if (lines.length > 0) {
        const runningPath = lines[0].trim();
        if (runningPath && runningPath.endsWith('.exe')) {
          // 如果不是缓存路径，添加到列表
          if (runningPath !== this.cachedWindsurfPath) {
            possiblePaths.unshift(runningPath);
            console.log(`[启动 Windsurf] Windows: 从运行进程获取路径: ${runningPath}`);
          }
        }
      }
    } catch (error) {
      // 进程未运行或wmic失败，继续
    }
    
    // 3. 尝试从注册表读取安装路径
    try {
      const registryPaths = [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Windsurf.exe',
        'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Windsurf.exe',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Windsurf',
        'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Windsurf'
      ];
      
      for (const regPath of registryPaths) {
        try {
          // 尝试读取默认值
          let result = execSync(`reg query "${regPath}" /ve 2>nul`, { encoding: 'utf-8' });
          let match = result.match(/REG_SZ\s+(.+)/);
          
          // 如果默认值不存在，尝试读取InstallLocation
          if (!match) {
            result = execSync(`reg query "${regPath}" /v InstallLocation 2>nul`, { encoding: 'utf-8' });
            match = result.match(/InstallLocation\s+REG_SZ\s+(.+)/);
            if (match && match[1]) {
              const installDir = match[1].trim();
              const exePath = path.join(installDir, 'Windsurf.exe');
              possiblePaths.unshift(exePath);
              console.log(`[启动 Windsurf] Windows: 从注册表获取安装目录: ${exePath}`);
            }
          } else if (match && match[1]) {
            const exePath = match[1].trim();
            possiblePaths.unshift(exePath);
            console.log(`[启动 Windsurf] Windows: 从注册表获取路径: ${exePath}`);
          }
        } catch {
          // 注册表项不存在，继续
        }
      }
    } catch (error) {
      console.log('[启动 Windsurf] Windows: 无法读取注册表，使用默认路径');
    }
    
    // 4. 系统级安装 - 使用环境变量（支持任意盘符）
    if (process.env.PROGRAMFILES) {
      possiblePaths.push(path.join(process.env.PROGRAMFILES, 'Windsurf', 'Windsurf.exe'));
    }
    if (process.env['PROGRAMFILES(X86)']) {
      possiblePaths.push(path.join(process.env['PROGRAMFILES(X86)'], 'Windsurf', 'Windsurf.exe'));
    }
    
    // 5. 常见盘符的Program Files（C/D/E/F/G盘）
    const commonDrives = ['C', 'D', 'E', 'F', 'G'];
    for (const drive of commonDrives) {
      possiblePaths.push(`${drive}:\\Program Files\\Windsurf\\Windsurf.exe`);
      possiblePaths.push(`${drive}:\\Program Files (x86)\\Windsurf\\Windsurf.exe`);
    }
    
    // 6. 去重（避免重复检测）
    const uniquePaths = [...new Set(possiblePaths)];
    
    console.log(`[启动 Windsurf] Windows: 开始搜索，共 ${uniquePaths.length} 个可能路径`);
    
    // 查找存在的可执行文件
    let exePath = null;
    for (const testPath of uniquePaths) {
      try {
        await fs.access(testPath);
        exePath = testPath;
        console.log(`[启动 Windsurf] Windows: ✅ 找到可执行文件: ${exePath}`);
        break;
      } catch {
        // 文件不存在，继续
      }
    }
    
    if (!exePath) {
      console.error('[启动 Windsurf] Windows: ❌ 未找到 Windsurf.exe');
      console.error('[启动 Windsurf] Windows: 已搜索以下路径:');
      uniquePaths.forEach(p => console.error(`  - ${p}`));
      
      // 提供更详细的错误信息
      let errorMsg = '无法找到 Windsurf 安装路径\n请确保 Windsurf 已正确安装';
      if (this.cachedWindsurfPath) {
        errorMsg += `\n\n已尝试缓存路径: ${this.cachedWindsurfPath}`;
      }
      throw new Error(errorMsg);
    }
    
    // 使用 spawn 启动 Windsurf（detached模式，不阻塞）
    try {
      const child = spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      
      // 分离子进程，让它独立运行
      child.unref();
      
      console.log('[启动 Windsurf] Windows: 启动命令已执行');
      console.log(`[启动 Windsurf] Windows: 进程ID: ${child.pid}`);
    } catch (error) {
      console.error('[启动 Windsurf] Windows: spawn失败，尝试使用cmd启动');
      // 降级方案：使用cmd启动
      const command = `start "" "${exePath}"`;
      await execAsync(command, { shell: 'cmd.exe' });
      console.log('[启动 Windsurf] Windows: 使用cmd启动成功');
    }
  }
  
  /**
   * macOS: 启动 Windsurf
   */
  static async startWindsurfMacOS(execAsync) {
    const os = require('os');
    
    // 可能的应用路径
    const possiblePaths = [
      '/Applications/Windsurf.app',
      path.join(os.homedir(), 'Applications', 'Windsurf.app')
    ];
    
    // 查找存在的应用
    let appPath = null;
    for (const testPath of possiblePaths) {
      try {
        await fs.access(testPath);
        appPath = testPath;
        console.log(`[启动 Windsurf] macOS: 找到应用: ${appPath}`);
        break;
      } catch {
        // 应用不存在，继续
      }
    }
    
    if (!appPath) {
      throw new Error('无法找到 Windsurf.app\n请确保 Windsurf 已正确安装在 /Applications 或 ~/Applications');
    }
    
    // 启动 Windsurf
    await execAsync(`open "${appPath}"`);
    console.log('[启动 Windsurf] macOS: 启动命令已执行');
  }
  
  /**
   * 检查 Windsurf 是否正在运行
   */
  static async isRunning() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      if (process.platform === 'win32') {
        return await this.isRunningWindows(execAsync);
      } else if (process.platform === 'darwin') {
        return await this.isRunningMacOS(execAsync);
      } else {
        return false;
      }
    } catch (error) {
      console.error('[检测进程] 意外错误:', error.message);
      return false;
    }
  }
  
  /**
   * Windows: 检测 Windsurf 是否运行
   */
  static async isRunningWindows(execAsync) {
    try {
      // 检测所有 Windsurf 相关进程
      // 注意: tasklist 不支持通配符，需要分别检测
      const processNames = ['Windsurf.exe', 'Windsurf Helper.exe'];
      
      for (const processName of processNames) {
        try {
          const { stdout } = await execAsync(
            `tasklist /FI "IMAGENAME eq ${processName}" /NH`, 
            { shell: 'cmd.exe' }
          );
          
          // 检查输出是否包含进程名（忽略 "INFO: No tasks" 等信息）
          if (stdout.toLowerCase().includes(processName.toLowerCase())) {
            console.log(`[检测进程] Windows: 发现进程 ${processName}`);
            return true;
          }
        } catch (error) {
          // 单个进程检测失败，继续检测下一个
          continue;
        }
      }
      
      // 所有进程都未找到
      return false;
      
    } catch (error) {
      console.error('[检测进程] Windows 检测失败:', error.message);
      // 检测失败时返回 false（保守策略）
      return false;
    }
  }
  
  /**
   * macOS: 检测 Windsurf 是否运行
   */
  static async isRunningMacOS(execAsync) {
    try {
      // 方法1: 使用 pgrep 精确匹配主进程
      try {
        const { stdout } = await execAsync('pgrep -x "Windsurf"');
        if (stdout.trim().length > 0) {
          console.log('[检测进程] macOS: 发现 Windsurf 主进程 (pgrep)');
          return true;
        }
      } catch (error) {
        // pgrep 返回 1 表示没找到进程（正常）
        if (error.code === 1) {
          // 继续尝试其他方法
        } else {
          console.warn('[检测进程] macOS: pgrep 执行失败:', error.message);
        }
      }
      
      // 方法2: 使用 ps 命令检测
      try {
        const { stdout } = await execAsync('ps aux | grep -i "Windsurf.app" | grep -v grep');
        if (stdout.trim().length > 0) {
          console.log('[检测进程] macOS: 发现 Windsurf 进程 (ps)');
          return true;
        }
      } catch (error) {
        // grep 没找到匹配会返回非 0，这是正常的
        if (error.code === 1) {
          // 没找到进程
          return false;
        } else {
          console.warn('[检测进程] macOS: ps 执行失败:', error.message);
        }
      }
      
      // 所有方法都未检测到进程
      return false;
      
    } catch (error) {
      console.error('[检测进程] macOS 检测失败:', error.message);
      // 检测失败时返回 false（保守策略）
      return false;
    }
  }
  
  /**
   * 关闭 Windsurf（优雅关闭 + 强制关闭）- 改进版
   */
  static async closeWindsurf() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      console.log('[关闭 Windsurf] 开始关闭流程...');
      
      if (process.platform === 'win32') {
        return await this.closeWindsurfWindows(execAsync);
      } else if (process.platform === 'darwin') {
        return await this.closeWindsurfMacOS(execAsync);
      }
      
      throw new Error('不支持的操作系统');
    } catch (error) {
      console.error('[关闭 Windsurf] 错误:', error);
      throw error;
    }
  }
  
  // 静态变量：缓存 Windows 上 Windsurf 的可执行文件路径
  static cachedWindsurfPath = null;
  
  /**
   * Windows: 获取正在运行的 Windsurf 可执行文件路径
   */
  static async getRunningWindsurfPath(execAsync) {
    try {
      const { stdout } = await execAsync(
        'wmic process where "name=\'Windsurf.exe\'" get ExecutablePath /format:list',
        { shell: 'cmd.exe', timeout: 5000 }
      );
      const match = stdout.match(/ExecutablePath=(.+\.exe)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (error) {
      // 获取失败，忽略
    }
    return null;
  }
  
  /**
   * Windows: 关闭 Windsurf
   */
  static async closeWindsurfWindows(execAsync) {
    console.log('[关闭 Windsurf] Windows: 开始关闭...');
    
    // 步骤 0: 在关闭前缓存运行中的 Windsurf 路径（用于后续启动）
    try {
      const runningPath = await this.getRunningWindsurfPath(execAsync);
      if (runningPath) {
        this.cachedWindsurfPath = runningPath;
        console.log(`[关闭 Windsurf] Windows: 已缓存路径: ${runningPath}`);
      }
    } catch (error) {
      console.log('[关闭 Windsurf] Windows: 获取运行路径失败，继续关闭');
    }
    
    // 步骤 1: 优雅关闭（带子进程树）
    console.log('[关闭 Windsurf] Windows: 尝试优雅关闭...');
    try {
      await execAsync('taskkill /IM Windsurf.exe /T 2>nul', { shell: 'cmd.exe' });
      console.log('[关闭 Windsurf] Windows: 已发送关闭信号');
    } catch (error) {
      console.log('[关闭 Windsurf] Windows: 优雅关闭命令执行失败（进程可能不存在）');
    }
    
    // 等待进程关闭（最多 5 秒）
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await this.isRunning()) {
        console.log('[关闭 Windsurf] Windows: 优雅关闭成功');
        return { success: true, method: 'graceful' };
      }
      console.log(`[关闭 Windsurf] Windows: 等待关闭... (${i + 1}/5)`);
    }
    
    // 步骤 2: 强制关闭所有相关进程
    console.log('[关闭 Windsurf] Windows: 优雅关闭超时，使用强制关闭...');
    const processNames = ['Windsurf.exe', 'Windsurf Helper.exe', 'Windsurf GPU.exe'];
    
    for (const processName of processNames) {
      try {
        await execAsync(`taskkill /F /T /IM "${processName}" 2>nul`, { shell: 'cmd.exe' });
        console.log(`[关闭 Windsurf] Windows: 已强制关闭 ${processName}`);
      } catch (error) {
        // 进程可能不存在，忽略
      }
    }
    
    // 最终验证（增加重试次数和等待时间）
    console.log('[关闭 Windsurf] Windows: 验证进程是否已关闭...');
    let stillRunning = false;
    
    // 多次检测，避免误判（最多检测 3 次，每次间隔 1.5 秒）
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      stillRunning = await this.isRunning();
      
      if (!stillRunning) {
        console.log('[关闭 Windsurf] Windows: 所有进程已关闭');
        return { success: true, method: 'force' };
      }
      
      console.log(`[关闭 Windsurf] Windows: 进程仍在运行，重试检测... (${i + 1}/3)`);
    }
    
    // 如果仍在运行，返回警告而不是抛出错误
    if (stillRunning) {
      console.warn('[关闭 Windsurf] Windows: 部分进程可能仍在运行');
      return { 
        success: false, 
        warning: true,
        message: '部分 Windsurf 进程可能仍在运行，建议手动关闭后重试'
      };
    }
    
    console.log('[关闭 Windsurf] Windows: 所有进程已关闭');
    return { success: true, method: 'force' };
  }
  
  /**
   * macOS: 关闭 Windsurf
   */
  static async closeWindsurfMacOS(execAsync) {
    console.log('[关闭 Windsurf] macOS: 开始关闭...');
    
    // 步骤 1: 使用 osascript 优雅退出
    console.log('[关闭 Windsurf] macOS: 尝试使用 AppleScript 退出...');
    try {
      await execAsync('osascript -e \'tell application "Windsurf" to quit\' 2>/dev/null');
      console.log('[关闭 Windsurf] macOS: 已发送退出信号');
    } catch (error) {
      console.log('[关闭 Windsurf] macOS: AppleScript 失败，尝试其他方法');
    }
    
    // 等待进程关闭（最多 5 秒）
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await this.isRunning()) {
        console.log('[关闭 Windsurf] macOS: 优雅关闭成功');
        return { success: true, method: 'graceful' };
      }
      console.log(`[关闭 Windsurf] macOS: 等待关闭... (${i + 1}/5)`);
    }
    
    // 步骤 2: 使用 SIGTERM (15) 信号
    console.log('[关闭 Windsurf] macOS: 优雅关闭超时，发送 SIGTERM...');
    try {
      await execAsync('pkill -15 -f "Windsurf.app/Contents/MacOS/Windsurf" 2>/dev/null');
      console.log('[关闭 Windsurf] macOS: 已发送 SIGTERM 信号');
    } catch (error) {
      console.log('[关闭 Windsurf] macOS: SIGTERM 发送失败');
    }
    
    // 等待 SIGTERM 生效（最多 3 秒）
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await this.isRunning()) {
        console.log('[关闭 Windsurf] macOS: SIGTERM 关闭成功');
        return { success: true, method: 'sigterm' };
      }
      console.log(`[关闭 Windsurf] macOS: 等待 SIGTERM 生效... (${i + 1}/3)`);
    }
    
    // 步骤 3: 最后使用 SIGKILL (9) 强制关闭 - 增强版
    console.log('[关闭 Windsurf] macOS: SIGTERM 超时，使用 SIGKILL 强制关闭...');
    try {
      // 获取当前进程 PID，避免自杀
      const currentPid = process.pid;
      
      // 强制杀死 Windsurf 主进程（精确匹配）
      await execAsync('killall -9 Windsurf 2>/dev/null || true');
      
      // 使用更精确的匹配模式，避免误杀当前工具
      // 只匹配 Windsurf.app/Contents 路径下的进程
      await execAsync('pkill -9 -f "Windsurf.app/Contents/MacOS" 2>/dev/null || true');
      await execAsync('pkill -9 -f "Windsurf.app/Contents/Frameworks.*Helper" 2>/dev/null || true');
      
      console.log('[关闭 Windsurf] macOS: 已发送 SIGKILL 信号');
    } catch (error) {
      console.log('[关闭 Windsurf] macOS: SIGKILL 发送失败');
    }
    
    // 最终验证（增加重试次数和等待时间）
    console.log('[关闭 Windsurf] macOS: 验证进程是否已关闭...');
    let stillRunning = false;
    
    // 多次检测，避免误判（最多检测 3 次，每次间隔 1.5 秒）
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      stillRunning = await this.isRunning();
      
      if (!stillRunning) {
        console.log('[关闭 Windsurf] macOS: 所有进程已关闭');
        return { success: true, method: 'sigkill' };
      }
      
      console.log(`[关闭 Windsurf] macOS: 进程仍在运行，重试检测... (${i + 1}/3)`);
    }
    
    // 如果仍在运行，返回警告而不是抛出错误
    if (stillRunning) {
      console.warn('[关闭 Windsurf] macOS: 部分进程可能仍在运行');
      return { 
        success: false, 
        warning: true,
        message: '部分 Windsurf 进程可能仍在运行，建议手动关闭后重试'
      };
    }
    
    console.log('[关闭 Windsurf] macOS: 所有进程已关闭');
    return { success: true, method: 'sigkill' };
  }
}

/**
 * 账号切换器
 */
class AccountSwitcher {
  /**
   * 使用 refresh_token 获取 Firebase tokens（通过 Cloudflare Workers 中转）
   */
  static async getFirebaseTokens(refreshToken) {
    const axios = require('axios');
    const _CONSTANTS = getLocalConstants();
    const FIREBASE_API_KEY = _CONSTANTS.FIREBASE_API_KEY;
    const WORKER_URL = _CONSTANTS.WORKER_URL;
    
    try {
      // 使用 JSON 格式请求（与 accountQuery.js 保持一致）
      const response = await axios.post(
        WORKER_URL,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          api_key: FIREBASE_API_KEY
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: _CONSTANTS.REQUEST_TIMEOUT
        }
      );
      
      // 返回完整的 Firebase tokens
      return {
        idToken: response.data.id_token,
        accessToken: response.data.access_token || response.data.id_token,
        refreshToken: response.data.refresh_token || refreshToken,
        expiresIn: parseInt(response.data.expires_in || 3600)
      };
    } catch (error) {
      // 打印详细错误信息
      if (error.response) {
        console.error('Workers 返回错误:', error.response.data);
        throw new Error(`Workers 错误: ${JSON.stringify(error.response.data)}`);
      }
      // 网络错误提示
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        throw new Error('无法连接到中转服务器，请检查网络连接或开启代理');
      }
      throw error;
    }
  }
  
  /**
   * 使用 access_token 获取 api_key
   */
  static async getApiKey(accessToken) {
    const axios = require('axios');
    const _CONSTANTS = getLocalConstants();
    
    try {
      const response = await axios.post(
        _CONSTANTS.WINDSURF_REGISTER_API,
        {
          firebase_id_token: accessToken
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: _CONSTANTS.REQUEST_TIMEOUT
        }
      );
      
      return {
        apiKey: response.data.api_key,
        name: response.data.name,
        apiServerUrl: response.data.api_server_url
      };
    } catch (error) {
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        throw new Error('无法连接到 Windsurf 服务器，请检查网络连接或开启代理');
      }
      throw error;
    }
  }
  
  /**
   * 跨平台加密 sessions 数据 - 使用 Electron safeStorage API
   */
  static async encryptSessions(sessionsData) {
    const jsonString = JSON.stringify(sessionsData);
    
    try {
      // 检查 safeStorage 是否可用
      if (typeof safeStorage === 'undefined' || !safeStorage.isEncryptionAvailable()) {
        throw new Error('Electron safeStorage 不可用');
      }
      
      console.log('[加密] 使用 Electron safeStorage API 加密...');
      const encryptedBuffer = safeStorage.encryptString(jsonString);
      
      console.log('[加密] ✅ 加密成功，Buffer 长度:', encryptedBuffer.length);
      console.log('[加密] 格式: Electron safeStorage 原生格式');
      
      return encryptedBuffer;
    } catch (error) {
      console.error('[加密] ❌ 加密失败:', error);
      throw error;
    }
  }
  
  /**
   * 验证加密是否可用
   */
  static isEncryptionAvailable() {
    try {
      return typeof safeStorage !== 'undefined' && safeStorage.isEncryptionAvailable();
    } catch (error) {
      console.error('[加密] 检查加密可用性失败:', error);
      return false;
    }
  }
  
  /**
   * Windows: 验证 Local State 文件是否存在
   */
  static checkLocalStateForWindows() {
    if (process.platform !== 'win32') {
      return { success: true, message: '非Windows平台，无需检查' };
    }
    
    try {
      const { app } = require('electron');
      const toolUserData = app.getPath('userData');
      const toolLocalState = path.join(toolUserData, 'Local State');
      
      const fs = require('fs');
      if (!fs.existsSync(toolLocalState)) {
        return {
          success: false,
          message: 'Local State 文件不存在',
          suggestion: '请确保 Windsurf 已安装并至少运行过一次'
        };
      }
      
      // 检查文件内容
      const localState = JSON.parse(fs.readFileSync(toolLocalState, 'utf-8'));
      if (!localState.os_crypt || !localState.os_crypt.encrypted_key) {
        return {
          success: false,
          message: 'Local State 文件格式不正确',
          suggestion: '请重新安装 Windsurf 或联系技术支持'
        };
      }
      
      return {
        success: true,
        message: 'Local State 文件正常',
        encryptedKeyLength: localState.os_crypt.encrypted_key.length
      };
    } catch (error) {
      return {
        success: false,
        message: `检查失败: ${error.message}`,
        suggestion: '请确保有足够的文件访问权限'
      };
    }
  }
  
  /**
   * 解密 sessions 数据 - 使用 Electron safeStorage API（用于测试）
   */
  static async decryptSessions(encryptedBuffer) {
    try {
      if (typeof safeStorage === 'undefined' || !safeStorage.isEncryptionAvailable()) {
        throw new Error('Electron safeStorage 不可用');
      }
      
      console.log('[解密] 使用 Electron safeStorage API 解密...');
      const decryptedString = safeStorage.decryptString(encryptedBuffer);
      
      console.log('[解密] ✅ 解密成功');
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('[解密] ❌ 解密失败:', error);
      throw error;
    }
  }
  
  /**
   * 测试加密解密是否正常工作
   */
  static async testEncryption() {
    try {
      console.log('[测试] 开始加密解密测试...');
      
      const testData = [{
        id: 'test-session',
        accessToken: 'test-token',
        account: { id: 'test-id', label: 'test@example.com' }
      }];
      
      // 加密
      const encrypted = await this.encryptSessions(testData);
      console.log('[测试] 加密成功，长度:', encrypted.length);
      
      // 解密
      const decrypted = await this.decryptSessions(encrypted);
      console.log('[测试] 解密成功');
      
      // 验证
      const match = JSON.stringify(testData) === JSON.stringify(decrypted);
      console.log('[测试] 数据匹配:', match ? '' : '');
      
      return match;
    } catch (error) {
      console.error('[测试] 测试失败:', error);
      return false;
    }
  }
  
  /**
   * 写入数据库（使用 sql.js - 唯一可靠的方案）
   */
  static async writeToDB(key, value) {
    const initSqlJs = require('sql.js');
    const dbPath = WindsurfPathDetector.getDBPath();
    
    try {
      // 检查值是否为 null 或 undefined
      if (value === null || value === undefined) {
        console.error(`尝试写入 null/undefined 值到 key: ${key}`);
        throw new Error(`Cannot write null/undefined value to key: ${key}`);
      }
      
      // 读取数据库文件
      const dbBuffer = await fs.readFile(dbPath);
      
      // 初始化 sql.js
      const SQL = await initSqlJs();
      const db = new SQL.Database(dbBuffer);
      
      try {
        let finalValue;
        
        // 处理不同类型的值
        if (Buffer.isBuffer(value)) {
          // Buffer 需要转为 JSON 格式的字符串（Windsurf 的存储格式）
          finalValue = JSON.stringify({
            type: 'Buffer',
            data: Array.from(value)
          });
        } else if (typeof value === 'object') {
          // 普通对象转为 JSON 字符串
          finalValue = JSON.stringify(value);
          // 验证 JSON 字符串不是 "null"
          if (finalValue === 'null') {
            console.error(`JSON.stringify 返回 "null" for key: ${key}`, value);
            throw new Error(`JSON.stringify returned "null" for key: ${key}`);
          }
        } else {
          // 字符串直接使用
          finalValue = value;
        }
        
        // 执行插入或更新
        db.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', [key, finalValue]);
        
        // 导出数据库
        const data = db.export();
        
        // 写回文件
        await fs.writeFile(dbPath, data);
        
        console.log(`已写入数据库 (sql.js): ${key}`);
        return true;
      } finally {
        db.close();
      }
    } catch (error) {
      console.error(`sql.js 写入失败:`, error);
      throw error;
    }
  }
  
  /**
   * 备份数据库
   */
  static async backupDB() {
    const dbPath = WindsurfPathDetector.getDBPath();
    const backupPath = dbPath + '.backup.' + Date.now();
    
    try {
      await fs.copyFile(dbPath, backupPath);
      console.log('数据库已备份:', backupPath);
    } catch (error) {
      console.warn('备份数据库失败:', error.message);
    }
  }
  
  /**
   * 生成标准的机器 ID
   */
  static generateMachineIds() {
    return {
      machineId: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
      macMachineId: crypto.createHash('sha512').update(crypto.randomBytes(64)).digest('hex'),
      sqmId: `{${uuidv4().toUpperCase()}}`,
      devDeviceId: uuidv4(),
      serviceMachineId: uuidv4()
    };
  }
  
  /**
   * 重置机器 ID (跨平台)
   */
  static async resetMachineId() {
    const platform = process.platform;
    const storageJsonPath = WindsurfPathDetector.getStorageJsonPath();
    
    try {
      // 生成新的机器 ID
      const ids = this.generateMachineIds();
      
      // 读取 storage.json，如果不存在则创建
      let storageData = {};
      try {
        const content = await fs.readFile(storageJsonPath, 'utf-8');
        storageData = JSON.parse(content);
      } catch (error) {
        console.warn('[机器码] storage.json 不存在或格式错误，创建新文件');
        storageData = {};
      }
      
      // 更新机器 ID 字段
      storageData['telemetry.machineId'] = ids.machineId;
      storageData['telemetry.sqmId'] = ids.sqmId;
      storageData['telemetry.devDeviceId'] = ids.devDeviceId;
      
      // macOS 特有字段
      if (platform === 'darwin') {
        storageData['telemetry.macMachineId'] = ids.macMachineId;
      }
      
      // 写回 storage.json（带重试逻辑）
      const maxRetries = 5;
      let lastError = null;
      for (let i = 0; i < maxRetries; i++) {
        try {
          // 等待文件句柄释放
          if (i > 0) {
            console.log(`[机器码] 等待文件释放，重试 ${i + 1}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          }
          await fs.writeFile(storageJsonPath, JSON.stringify(storageData, null, 2));
          console.log('[机器码] storage.json 已更新');
          lastError = null;
          break;
        } catch (writeError) {
          lastError = writeError;
          console.warn(`[机器码] 写入失败 (${i + 1}/${maxRetries}): ${writeError.message}`);
        }
      }
      
      if (lastError) {
        throw lastError;
      }
      
      // Windows: 重置注册表
      if (platform === 'win32') {
        const registryResult = await this.resetWindowsRegistry();
        if (!registryResult) {
          console.warn('[机器码] Windows 注册表未重置（需要管理员权限）');
          console.warn('[机器码] 这不影响切号，storage.json 的机器ID已成功重置');
          ids.registryResetFailed = true;
        } else {
          ids.registryGuid = registryResult;
          ids.registryResetFailed = false;
        }
      }
      
      return ids;
    } catch (error) {
      throw new Error(`重置机器 ID 失败: ${error.message}`);
    }
  }
  
  /**
   * Windows: 重置注册表 MachineGuid
   */
  static async resetWindowsRegistry() {
    try {
      const newGuid = uuidv4();
      const registryPath = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography';
      
      // 尝试修改注册表
      const command = `reg add "${registryPath}" /v MachineGuid /t REG_SZ /d "${newGuid}" /f`;
      execSync(command, { encoding: 'utf-8' });
      
      // 验证是否修改成功
      try {
        const verifyCommand = `reg query "${registryPath}" /v MachineGuid`;
        const output = execSync(verifyCommand, { encoding: 'utf-8' });
        
        if (output.includes(newGuid)) {
          console.log('[注册表] Windows 注册表 MachineGuid 已重置并验证');
          return newGuid;
        } else {
          console.warn('[注册表] 注册表修改后验证失败');
          return null;
        }
      } catch (verifyError) {
        console.warn('[注册表] 无法验证注册表修改');
        return newGuid; // 假设成功
      }
      
    } catch (error) {
      // 检查是否是权限问题
      if (error.message.includes('Access is denied') || error.message.includes('拒绝访问')) {
        console.warn('[注册表] 重置注册表失败: 需要管理员权限');
        console.warn('[注册表] 这不影响切号，storage.json 的机器ID已成功重置');
      } else {
        console.warn('[注册表] 重置注册表失败:', error.message);
      }
      return null;
    }
  }
  
  /**
   * 切换账号（主函数）
   * @param {Object} account - 账号信息
   * @param {Function} logCallback - 日志回调函数
   */
  static async switchAccount(account, logCallback = null) {
    const log = (msg) => {
      console.log(msg);
      if (logCallback) logCallback(msg);
    };
    
    try {
      log('[切号] 准备切换账号...');
      log(`[切号] 目标账号: ${account.email}`);
      
      // Windows: 检查加密环境
      if (process.platform === 'win32') {
        const localStateCheck = this.checkLocalStateForWindows();
        if (!localStateCheck.success) {
          log('[切号] Local State 检查失败');
          log(`[切号]    错误: ${localStateCheck.message}`);
          log(`[切号]    建议: ${localStateCheck.suggestion}`);
          throw new Error(`Windows 加密环境异常: ${localStateCheck.message}\n${localStateCheck.suggestion}`);
        }
      }
      
      // ========== 步骤 1: 检查并关闭 Windsurf ==========
      log('[切号] ========== 步骤 1: 检查并关闭 Windsurf ==========');
      
      const isInstalled = await WindsurfPathDetector.isInstalled();
      if (!isInstalled) {
        throw new Error('未检测到 Windsurf，请确保已安装');
      }
      log('[切号] Windsurf 已安装');
      
      const isRunning = await WindsurfPathDetector.isRunning();
      if (isRunning) {
        log('[切号] 检测到 Windsurf 正在运行');
        log('[切号]  必须关闭 Windsurf 才能安全切换账号');
        log('[切号] 正在关闭 Windsurf...');
        
        const closeResult = await WindsurfPathDetector.closeWindsurf();
        
        // 检查关闭结果
        if (closeResult.success) {
          log(`[切号] Windsurf 已关闭 (方式: ${closeResult.method})`);
          // 等待进程完全退出，释放文件句柄
          log('[切号] 等待进程完全退出...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else if (closeResult.warning) {
          // 关闭可能失败，但允许用户选择继续
          log(`[切号] ${closeResult.message}`);
          log('[切号] 建议：请手动关闭所有 Windsurf 窗口后重试');
          log('[切号] 如果确认已关闭，可以忽略此警告继续');
          
          // 再次检测，给用户一个确认的机会
          await new Promise(resolve => setTimeout(resolve, 2000));
          const stillRunning = await WindsurfPathDetector.isRunning();
          
          if (stillRunning) {
            throw new Error('检测到 Windsurf 进程仍在运行\n请手动关闭所有 Windsurf 窗口后重试');
          } else {
            log('[切号] 二次检测：Windsurf 已关闭');
          }
        }
      } else {
        log('[切号] Windsurf 未运行，无需关闭');
      }
      
      // ========== 步骤 2: 重置机器 ID ==========
      log('[切号] ========== 步骤 2: 重置机器 ID ==========');
      
      const ids = await this.resetMachineId();
      log(`[切号] 机器 ID 已重置`);
      log(`[切号]    machineId: ${ids.machineId.substring(0, 16)}...`);
      log(`[切号]    sqmId: ${ids.sqmId}`);
      log(`[切号]    devDeviceId: ${ids.devDeviceId}`);
      if (ids.macMachineId) {
        log(`[切号]    macMachineId: ${ids.macMachineId.substring(0, 16)}...`);
      }
      
      // Windows 注册表状态
      if (process.platform === 'win32') {
        if (ids.registryResetFailed) {
          log('[切号]  Windows 注册表未能重置（需要管理员权限）');
          log('[切号] 这不影响切号，storage.json 的机器ID已成功重置');
        } else if (ids.registryGuid) {
          log(`[切号]    注册表 GUID: ${ids.registryGuid}`);
        }
      }
      
      // 步骤 3: 获取账号凭证
      let apiKey, name, apiServerUrl, firebaseToken;
      
      // 优先使用账号文件中已有的数据
      if (account.apiKey && account.name && account.apiServerUrl) {
        apiKey = account.apiKey;
        name = account.name;
        apiServerUrl = account.apiServerUrl;
        
        // 检查 idToken 是否存在且未过期
        const now = Date.now();
        const tokenExpired = account.idTokenExpiresAt && now >= account.idTokenExpiresAt;
        
        if (account.idToken && !tokenExpired) {
          firebaseToken = account.idToken;
        } else if (account.refreshToken) {
          try {
            const tokens = await this.getFirebaseTokens(account.refreshToken);
            firebaseToken = tokens.idToken;
            
            // 更新账号文件中的 idToken 和过期时间
            try {
              const { app } = require('electron');
              const accountsFilePath = path.join(app.getPath('userData'), 'accounts.json');
              const accountsData = await fs.readFile(accountsFilePath, 'utf-8');
              const accounts = JSON.parse(accountsData);
              
              const accountIndex = accounts.findIndex(acc => acc.id === account.id || acc.email === account.email);
              if (accountIndex !== -1) {
                accounts[accountIndex].idToken = tokens.idToken;
                accounts[accountIndex].idTokenExpiresAt = now + (tokens.expiresIn * 1000);
                accounts[accountIndex].refreshToken = tokens.refreshToken;
                accounts[accountIndex].updatedAt = new Date().toISOString();
                
                await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
              }
            } catch (updateError) {
              log(`[切号] 更新账号文件失败: ${updateError.message}`);
            }
          } catch (e) {
            log(`[切号] 获取 Firebase token 失败`);
            log(`[切号]    错误: ${e.message}`);
            log(`[切号]    建议: 请检查 refreshToken 是否有效`);
            throw new Error(`获取 Firebase token 失败: ${e.message}\n请检查 refreshToken 是否有效`);
          }
        } else {
          log(`[切号] 账号凭证不完整`);
          log(`[切号]    错误: 缺少 idToken 和 refreshToken`);
          log(`[切号]    建议: 请重新登录获取 Token`);
          throw new Error('账号缺少 idToken 和 refreshToken，无法切换\n请重新登录获取 Token');
        }
      } else {
        // 如果账号文件中没有，则通过 API 获取
        if (!account.refreshToken) {
          log(`[切号] 账号凭证不完整`);
          log(`[切号]    错误: 缺少 refreshToken 和 apiKey`);
          log(`[切号]    建议: 请确保账号信息完整`);
          throw new Error('账号缺少 refreshToken 和 apiKey，无法切换');
        }
        
        try {
          const tokens = await this.getFirebaseTokens(account.refreshToken);
          firebaseToken = tokens.idToken;
          
          const apiKeyInfo = await this.getApiKey(tokens.accessToken);
          apiKey = apiKeyInfo.apiKey;
          name = apiKeyInfo.name;
          apiServerUrl = apiKeyInfo.apiServerUrl;
          
          // 保存到账号文件，以便下次直接使用
          try {
            const { app } = require('electron');
            const accountsFilePath = path.join(app.getPath('userData'), 'accounts.json');
            let accounts = [];
            try {
              const data = await fs.readFile(accountsFilePath, 'utf-8');
              accounts = JSON.parse(data);
            } catch (e) {
              log('[切号] 读取账号文件失败，跳过保存');
            }
            
            const accountIndex = accounts.findIndex(acc => acc.id === account.id || acc.email === account.email);
            if (accountIndex !== -1) {
              const now = Date.now();
              accounts[accountIndex] = {
                ...accounts[accountIndex],
                apiKey,
                name,
                apiServerUrl,
                idToken: firebaseToken,
                idTokenExpiresAt: now + (3600 * 1000),
                updatedAt: new Date().toISOString()
              };
              await fs.writeFile(accountsFilePath, JSON.stringify(accounts, null, 2), { encoding: 'utf-8' });
            }
          } catch (e) {
            log(`[切号] 保存凭证数据失败: ${e.message}`);
          }
        } catch (e) {
          log(`[切号] 获取账号凭证失败`);
          log(`[切号]    错误: ${e.message}`);
          log(`[切号]    建议: 请检查网络连接和账号状态`);
          throw e;
        }
      }
      
      // 步骤 4: 写入数据库
      const initSqlJs = require('sql.js');
      const dbPath = WindsurfPathDetector.getDBPath();
      let dbBuffer = await fs.readFile(dbPath);
      let SQL = await initSqlJs();
      let db = new SQL.Database(dbBuffer);
      
      let deletedCount = 0;
      
      // 删除所有旧登录数据
      const oldKeysResult = db.exec(`SELECT key FROM ItemTable WHERE key LIKE 'windsurf_auth-%'`);
      if (oldKeysResult.length > 0 && oldKeysResult[0].values.length > 0) {
        for (const row of oldKeysResult[0].values) {
          db.run('DELETE FROM ItemTable WHERE key = ?', [row[0]]);
          deletedCount++;
        }
      }
      
      const secretKeysResult = db.exec(`SELECT key FROM ItemTable WHERE key LIKE 'secret://%'`);
      if (secretKeysResult.length > 0 && secretKeysResult[0].values.length > 0) {
        for (const row of secretKeysResult[0].values) {
          db.run('DELETE FROM ItemTable WHERE key = ?', [row[0]]);
          deletedCount++;
        }
      }
      
      db.run('DELETE FROM ItemTable WHERE key = ?', ['windsurfAuthStatus']);
      deletedCount++;
      
      const data = db.export();
      await fs.writeFile(dbPath, data);
      db.close();
      
      // 构建并加密 sessions 数据
      const sessionsKey = 'secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.sessions"}';
      const sessionId = uuidv4();
      const sessionsData = [{
        id: sessionId,
        accessToken: apiKey,
        account: { label: name, id: name },
        scopes: []
      }];
      
      const encrypted = await this.encryptSessions(sessionsData);
      
      // 验证加密结果
      if (!encrypted || !Buffer.isBuffer(encrypted)) {
        log('[切号] Sessions 数据加密失败');
        log('[切号]    错误: 返回的不是 Buffer');
        throw new Error('Sessions 数据加密失败：返回的不是 Buffer');
      }
      if (encrypted.length === 0) {
        log('[切号] Sessions 数据加密失败');
        log('[切号]    错误: Buffer 长度为 0');
        throw new Error('Sessions 数据加密失败：Buffer 长度为 0');
      }
      
      // 验证加密数据可以被解密
      try {
        const testDecrypt = await this.decryptSessions(encrypted);
      } catch (e) {
        log('[切号] 加密数据验证失败');
        log(`[切号]    错误: ${e.message}`);
        log('[切号]    建议: 这可能导致 Windsurf 无法识别登录状态');
        throw new Error(`加密数据验证失败：${e.message}\n这可能导致 Windsurf 无法识别登录状态`);
      }
      
      // 写入所有必需数据
      await this.writeToDB(sessionsKey, encrypted);
      
      const teamId = uuidv4();
      const authStatus = {
        name, apiKey, email: account.email,
        teamId, planName: "Pro"
      };
      await this.writeToDB('windsurfAuthStatus', authStatus);
      
      const installationId = uuidv4();
      const codeiumConfig = {
        "codeium.installationId": installationId,
        "codeium.apiKey": apiKey,
        "apiServerUrl": apiServerUrl || "https://server.self-serve.windsurf.com",
        "codeium.hasOneTimeUpdatedUnspecifiedMode": true
      };
      await this.writeToDB('codeium.windsurf', codeiumConfig);
      await this.writeToDB('codeium.windsurf-windsurf_auth', name);
      
      // 步骤 5: 启动 Windsurf
      await WindsurfPathDetector.startWindsurf();
      
      log('[切号] 切换成功');
      log(`[切号] 账号: ${account.email} (${name})`);
      
      return {
        success: true,
        email: account.email,
        name: name,
        apiKey: apiKey
      };
      
    } catch (error) {
      log(`[切号] 切换失败: ${error.message}`);
      console.error('[切号] 错误详情:', error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 获取当前登录的账号信息（使用 sql.js）
   */
  static async getCurrentAccount() {
    const initSqlJs = require('sql.js');
    const dbPath = WindsurfPathDetector.getDBPath();
    
    try {
      const dbBuffer = await fs.readFile(dbPath);
      const SQL = await initSqlJs();
      const db = new SQL.Database(dbBuffer);
      
      try {
        const result = db.exec('SELECT value FROM ItemTable WHERE key = ?', ['windsurfAuthStatus']);
        
        if (result.length > 0 && result[0].values.length > 0) {
          const value = result[0].values[0][0];
          return JSON.parse(value);
        }
        
        return null;
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('sql.js 获取账号失败:', error);
      return null;
    }
  }
}

// 导出模块
module.exports = {
  WindsurfPathDetector,
  AccountSwitcher
};

// 全局函数（供 HTML 调用）
if (typeof window !== 'undefined') {
  window.WindsurfPathDetector = WindsurfPathDetector;
  window.AccountSwitcher = AccountSwitcher;
}

/**
 * 切换到指定账号（全局函数）- 带实时日志显示
 */
async function switchToAccount(accountId) {
  try {
    // 获取所有账号
    const accountsResult = await window.ipcRenderer.invoke('get-accounts');
    if (!accountsResult.success || !accountsResult.accounts) {
      showCustomAlert('获取账号列表失败', 'error');
      return;
    }
    
    const account = accountsResult.accounts.find(acc => acc.id === accountId);
    
    if (!account) {
      showCustomAlert('账号不存在', 'error');
      return;
    }
    
    // 创建日志显示模态框
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div class="modal-dialog modern-modal" style="max-width: 550px;" onclick="event.stopPropagation()">
        <div class="modern-modal-header">
          <div class="modal-title-row">
            <i data-lucide="refresh-cw" style="width: 24px; height: 24px; color: #007aff;"></i>
            <h3 class="modal-title">切换账号</h3>
          </div>
          <button class="modal-close-btn" id="closeSwitchModal" title="关闭">
            <i data-lucide="x" style="width: 20px; height: 20px;"></i>
          </button>
        </div>
        
        <div class="modern-modal-body">
          <div style="background: #f5f5f7; padding: 12px; border-radius: 8px; margin-bottom: 16px;">
            <div style="font-size: 13px; color: #86868b; margin-bottom: 4px;">目标账号</div>
            <div style="font-size: 15px; font-weight: 600; color: #1d1d1f;">${account.email}</div>
          </div>
          
          <div style="background: #1d1d1f; border-radius: 8px; padding: 12px; height: 240px; overflow-y: auto; font-family: 'Monaco', 'Menlo', monospace; font-size: 11px; line-height: 1.5;" id="switchLogContainer">
            <div style="color: #34c759;">准备切换账号...</div>
          </div>
        </div>
        
        <div class="modern-modal-footer" id="switchFooter">
          <div style="flex: 1; text-align: left; color: #86868b; font-size: 13px;" id="switchStatus">
            正在处理...
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 初始化图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    const logContainer = document.getElementById('switchLogContainer');
    const statusEl = document.getElementById('switchStatus');
    const closeBtn = document.getElementById('closeSwitchModal');
    
    // 切号状态标记
    let isSwitching = true;
    let switchAborted = false;
    
    // 关闭按钮处理
    closeBtn.onclick = async () => {
      if (isSwitching && !switchAborted) {
        // 切号进行中，询问是否中断
        const confirmAbort = await showCustomConfirm({
          title: '中断切号',
          message: '切号正在进行中，强制关闭可能导致数据不完整',
          subMessage: '确定要强制关闭吗？',
          confirmText: '强制关闭',
          type: 'warning'
        });
        
        if (!confirmAbort) {
          return;
        }
        
        switchAborted = true;
        addLog('用户中断切号操作');
        statusEl.textContent = '已中断';
        statusEl.style.color = '#ff9500';
      }
      
      // 清理资源
      window.ipcRenderer.removeListener('switch-log', logListener);
      modal.remove();
    };
    
    // 添加日志函数
    function addLog(message) {
      // 解析日志类型
      let color = '#ffffff';
      if (message.includes('') || message.includes('成功')) {
        color = '#34c759';
      } else if (message.includes('') || message.includes('失败') || message.includes('错误')) {
        color = '#ff3b30';
      } else if (message.includes('') || message.includes('警告')) {
        color = '#ff9500';
      } else if (message.includes('==========')) {
        color = '#007aff';
      }
      
      const log = document.createElement('div');
      log.style.color = color;
      log.textContent = message;
      logContainer.appendChild(log);
      logContainer.scrollTop = logContainer.scrollHeight;
      
      // 更新状态
      if (message.includes('切换完成')) {
        isSwitching = false;
        statusEl.textContent = '切换成功';
        statusEl.style.color = '#34c759';
      } else if (message.includes('切换失败')) {
        isSwitching = false;
        statusEl.textContent = '切换失败';
        statusEl.style.color = '#ff3b30';
      }
    }
    
    // 监听实时日志
    const logListener = (event, log) => {
      addLog(log);
    };
    window.ipcRenderer.on('switch-log', logListener);
    
    try {
      // 执行切换（通过 IPC 调用）
      // 注意：切换过程会自动检测并关闭 Windsurf
      const result = await window.ipcRenderer.invoke('switch-account', account);
      
      if (!result.success) {
        addLog(`切换失败: ${result.error}`);
        statusEl.textContent = '切换失败';
        statusEl.color = '#ff3b30';
      }
      
    } catch (error) {
      console.error('切换账号失败:', error);
      addLog(`发生错误: ${error.message}`);
      isSwitching = false;
      statusEl.textContent = '发生错误';
      statusEl.style.color = '#ff3b30';
    } finally {
      // 标记切号结束
      isSwitching = false;
      // 移除日志监听器
      window.ipcRenderer.removeListener('switch-log', logListener);
    }
    
    // 点击背景关闭
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    };
    
  } catch (error) {
    console.error('切换账号失败:', error);
    showCustomAlert(`切换失败: ${error.message}`, 'error');
  }
}

/**
 * 获取当前 Windsurf 登录的账号
 */
async function getCurrentWindsurfAccount() {
  try {
    const account = await window.ipcRenderer.invoke('get-current-windsurf-account');
    
    if (account) {
      console.log('当前 Windsurf 账号:', account);
      return account;
    } else {
      console.log('Windsurf 未登录');
      return null;
    }
  } catch (error) {
    console.error('获取当前账号失败:', error);
    return null;
  }
}

// 确保 switchToAccount 函数在全局作用域可用
if (typeof window !== 'undefined') {
  window.switchToAccount = switchToAccount;
  window.getCurrentWindsurfAccount = getCurrentWindsurfAccount;
  console.log('accountSwitcher.js: switchToAccount 函数已注册到全局作用域');
}
