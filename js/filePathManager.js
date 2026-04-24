// filePathManager.js - 配置文件路径管理模块
// 使用全局的 ipcRenderer (通过 window.ipcRenderer 访问)
// shell 已在 renderer.js 中全局声明，此处直接使用

/**
 * 文件路径管理器
 */
const FilePathManager = {
  /**
   * 加载所有文件路径
   */
  async loadFilePaths() {
    try {
      const result = await window.ipcRenderer.invoke('get-file-paths');
      
      if (result.success) {
        const paths = result.paths;
        
        // 显示路径
        const userDataPathEl = document.getElementById('userDataPath');
        const configFilePathEl = document.getElementById('configFilePath');
        const accountsFilePathEl = document.getElementById('accountsFilePath');
        const platformInfoEl = document.getElementById('platformInfo');
        
        if (userDataPathEl) {
          userDataPathEl.value = paths.userDataPath;
        }
        
        if (configFilePathEl) {
          configFilePathEl.value = paths.configFile;
        }
        
        if (accountsFilePathEl) {
          accountsFilePathEl.value = paths.accountsFile;
        }
        
        // 显示平台信息
        if (platformInfoEl) {
          const platformMap = {
            'win32': 'Windows',
            'darwin': 'macOS',
            'linux': 'Linux'
          };
          platformInfoEl.textContent = platformMap[paths.platform] || paths.platform;
        }
        
        console.log('配置文件路径加载成功');
        return { success: true, paths };
      } else {
        console.error('加载配置文件路径失败:', result.error);
        showCustomAlert('加载配置文件路径失败: ' + result.error, 'error');
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('加载配置文件路径失败:', error);
      showCustomAlert('加载配置文件路径失败: ' + error.message, 'error');
      return { success: false, error: error.message };
    }
  },
  
  /**
   * 复制路径到剪贴板
   */
  copyPath(inputId) {
    const input = document.getElementById(inputId);
    if (!input) {
      console.error('找不到输入框:', inputId);
      return;
    }
    
    input.select();
    document.execCommand('copy');
    
    // 显示复制成功提示
    const btn = event.target.closest('button');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="check" style="width: 14px; height: 14px;"></i> 已复制';
      
      // 重新初始化图标
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      }, 1500);
    }
    
    console.log('路径已复制到剪贴板:', input.value);
  },
  
  /**
   * 打开文件夹
   */
  async openFolder(inputId) {
    const input = document.getElementById(inputId);
    if (!input) {
      console.error('找不到输入框:', inputId);
      return;
    }
    
    const pathValue = input.value;
    if (!pathValue) {
      showCustomAlert('路径为空，无法打开', 'warning');
      return;
    }
    
    try {
      await shell.openPath(pathValue);
      console.log('已打开文件夹:', pathValue);
    } catch (error) {
      console.error('打开文件夹失败:', error);
      showCustomAlert('打开文件夹失败: ' + error.message, 'error');
    }
  },
  
  /**
   * 打开文件（显示文件所在文件夹并选中文件）
   */
  openFile(inputId) {
    const input = document.getElementById(inputId);
    if (!input) {
      console.error('找不到输入框:', inputId);
      return;
    }
    
    const filePath = input.value;
    if (!filePath) {
      showCustomAlert('文件路径为空，无法打开', 'warning');
      return;
    }
    
    try {
      shell.showItemInFolder(filePath);
      console.log('已打开文件:', filePath);
    } catch (error) {
      console.error('打开文件失败:', error);
      showCustomAlert('打开文件失败: ' + error.message, 'error');
    }
  }
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FilePathManager;
}

// 全局函数（用于HTML onclick调用）
function loadFilePaths() {
  return FilePathManager.loadFilePaths();
}

function copyPath(inputId) {
  return FilePathManager.copyPath(inputId);
}

function openFolder(inputId) {
  return FilePathManager.openFolder(inputId);
}

function openFile(inputId) {
  return FilePathManager.openFile(inputId);
}
