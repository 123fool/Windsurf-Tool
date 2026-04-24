const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * 跨平台浏览器进程关闭工具
 * 支持 JS 注册（puppeteer-real-browser）
 */
class BrowserKiller {
  /**
   * 检查进程是否存在（Windows）
   */
  static async checkProcessExistsWindows(processName) {
    try {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}" /NH`, { 
        encoding: 'utf8',
        timeout: 5000 
      });
      return stdout.toLowerCase().includes(processName.toLowerCase());
    } catch (e) {
      return false;
    }
  }

  /**
   * 强制杀死浏览器进程（Windows增强版）
   */
  static async forceKillBrowserProcessesWindows() {
    const processes = [
      'chrome.exe',           // Chrome浏览器主进程
      'chromedriver.exe',     // Chrome驱动
      'chromium.exe'          // Chromium
    ];

    console.log('[Windows] 开始关闭浏览器进程...');

    // 第一轮：使用 /T 参数杀死进程树
    for (const processName of processes) {
      try {
        // /F: 强制终止  /T: 终止进程树（包括子进程）  /IM: 映像名称
        execSync(`taskkill /F /T /IM ${processName} 2>nul`, { 
          stdio: 'ignore',
          timeout: 5000 
        });
        console.log(`[Windows] 已终止进程: ${processName}`);
      } catch (e) {
        // 进程可能不存在，忽略错误
      }
    }

    // 等待进程完全关闭
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 第二轮：验证并再次尝试
    let remainingProcesses = [];
    for (const processName of processes) {
      const exists = await this.checkProcessExistsWindows(processName);
      if (exists) {
        remainingProcesses.push(processName);
      }
    }

    if (remainingProcesses.length > 0) {
      console.log(`[Windows] 发现残留进程，再次尝试关闭: ${remainingProcesses.join(', ')}`);
      
      for (const processName of remainingProcesses) {
        try {
          // 使用更激进的方式
          execSync(`taskkill /F /T /IM ${processName}`, { 
            stdio: 'ignore',
            timeout: 5000 
          });
        } catch (e) {
          // 忽略错误
        }
      }
      
      // 再等待一次
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('[Windows] 浏览器进程关闭完成');
  }

  /**
   * 强制杀死浏览器进程（Mac）
   */
  static async forceKillBrowserProcessesMac() {
    const commands = [
      'pkill -9 -f "Google Chrome"',
      'pkill -9 -f "Chromium"',
      'pkill -9 -f "chrome"',
      'pkill -9 -f "chromium"'
    ];

    console.log('[Mac] 开始关闭浏览器进程...');

    for (const cmd of commands) {
      try {
        await execAsync(cmd, { timeout: 5000 });
        console.log(`[Mac] 执行命令: ${cmd}`);
      } catch (e) {
        // 进程可能不存在，忽略错误
      }
    }

    // 等待进程完全关闭
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[Mac] 浏览器进程关闭完成');
  }

  /**
   * 强制杀死浏览器进程（跨平台支持）
   */
  static async forceKillBrowserProcesses() {
    try {
      if (process.platform === 'win32') {
        await this.forceKillBrowserProcessesWindows();
      } else if (process.platform === 'darwin') {
        await this.forceKillBrowserProcessesMac();
      } else {
        throw new Error('不支持的操作系统，仅支持Windows和Mac系统');
      }
    } catch (e) {
      console.error('强制杀死浏览器进程时出错:', e);
      throw e;
    }
  }

  /**
   * 取消批量注册（跨平台支持，带异步保护）
   */
  static async cancelBatchRegistration(registrationBot, logCallback = null) {
    const log = logCallback || ((msg) => console.log(msg));
    
    // 防止重复调用
    if (this._cancelling) {
      log(' 取消操作正在进行中，请稍候...');
      return;
    }

    this._cancelling = true;

    try {
      log('\n 正在取消批量注册...');
      log('正在关闭所有浏览器窗口...');
      
      // 设置取消标志
      if (registrationBot) {
        registrationBot.isCancelled = true;
      }
      
      // 强制杀死所有浏览器进程
      log('正在强制终止浏览器进程...');
      await this.forceKillBrowserProcesses();
      
      log(' 已取消批量注册，所有浏览器窗口已关闭');
    } catch (error) {
      log(` 取消操作出错: ${error.message}`);
      throw error;
    } finally {
      // 确保标志被重置
      this._cancelling = false;
    }
  }
}

module.exports = BrowserKiller;
