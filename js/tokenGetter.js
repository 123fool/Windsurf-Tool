// tokenGetter.js - Token获取模块
// 使用全局的 ipcRenderer 和 ConfigManager (通过 window 访问)

// Token获取模块
const TokenGetter = {
  // 存储DOM元素引用
  elements: {},
  
  // 存储账号列表
  accountsList: [],

  // 判断账号的Token是否已过期（1小时）
  isTokenExpired(account) {
    if (!account || !account.apiKey) return true;

    // 优先使用专门的token更新时间字段，其次退回到updatedAt
    const ts = account.tokenUpdatedAt || account.updatedAt;
    if (!ts) return true;

    const updatedAt = new Date(ts).getTime();
    if (Number.isNaN(updatedAt)) return true;

    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    return now - updatedAt > oneHourMs;
  },
  
  // 初始化模块
  async initialize(containerId) {
    // 获取容器元素
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('找不到容器元素:', containerId);
      return false;
    }
    
    // 创建UI
    this.createUI(container);
    
    // 绑定事件
    this.bindEvents();
    
    try {
      // 初始化ConfigManager
      console.log('正在初始化配置管理器...');
      await window.ConfigManager.initialize();
      console.log('配置管理器初始化成功');
      
      // 加载配置
      console.log('正在加载配置文件...');
      const configResult = await window.ConfigManager.loadConfig();
      if (configResult.success) {
        console.log('配置文件加载成功:', window.ConfigManager.getConfigFilePath());
      } else {
        console.warn('配置文件加载失败，使用默认配置');
      }
    } catch (error) {
      console.error('配置文件初始化失败:', error);
    }
    
    // 加载账号列表
    await this.loadAccounts();
    
    // 初始化账号切换模块
    await this.initAccountSwitcher();
    
    return true;
  },
  
  // 创建UI
  createUI(container) {
    container.innerHTML = `
      <div class="token-getter-container" style="max-width: 1200px; margin: 0 auto;">
        
        <!-- 账号切换区域 -->
        <div id="accountSwitcherContainer"></div>
        
        <!-- 主内容区域 - 左右两栏布局 -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          
          <!-- 左侧：本地账号列表 -->
          <div style="background: #ffffff; border: 1px solid #e5e5ea; border-radius: 8px; padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <label style="font-size: 15px; font-weight: 600; color: #1d1d1f; margin: 0;">本地账号列表</label>
              <button class="btn btn-success refresh-accounts-btn" style="font-size: 11px; padding: 5px 10px; white-space: nowrap;">
                刷新
              </button>
            </div>
            
            <div id="accountList" style="
              border: 1px solid #d2d2d7; 
              border-radius: 6px; 
              max-height: 420px; 
              overflow-y: auto; 
              background: #fafafa;
              min-height: 100px;
              margin-bottom: 12px;
            ">
              <div class="account-list-placeholder" style="
                text-align: center; 
                color: #86868b; 
                padding: 32px 16px; 
                font-size: 12px;
              ">暂无本地账号<br><span style="font-size: 10px;">请先在"批量注册/账号管理"页面注册</span></div>
            </div>
            
            <div style="margin-bottom: 10px;">
              <button id="batchGetTokenButton" class="btn btn-warning" style="width: 100%; font-size: 13px; padding: 10px; white-space: nowrap; background: linear-gradient(135deg, #ff9500, #ff7700); border: none; color: white; font-weight: 600;">
                批量获取全部Token
              </button>
              <button id="cancelBatchGetButton" class="btn btn-danger" style="width: 100%; font-size: 13px; padding: 10px; white-space: nowrap; display: none; font-weight: 600;">
                取消批量获取
              </button>
            </div>
            
            <p style="margin: 0; font-size: 10px; color: #86868b; line-height: 1.4; text-align: center;">
              从本地账号列表选择账号，快速获取 Windsurf API Token<br>支持批量获取（最多同时4个并发）
            </p>
          </div>
          
          <!-- 右侧：账号详情 -->
          <div style="background: #ffffff; border: 1px solid #e5e5ea; border-radius: 8px; padding: 16px;">
            <label style="font-size: 15px; font-weight: 600; color: #1d1d1f; margin-bottom: 12px; display: block;">账号详情</label>
            
            <div id="accountDetail" style="display: none;">
              <div class="form-group" style="margin-bottom: 12px;">
                <label style="font-size: 12px; font-weight: 500; color: #1d1d1f; margin-bottom: 6px; display: block;">邮箱账号</label>
                <input type="text" id="email" readonly style="width: 100%; padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 6px; font-size: 12px; background: #fafafa; color: #1d1d1f;">
              </div>
              
              <div class="form-group" style="margin-bottom: 12px;">
                <label style="font-size: 12px; font-weight: 500; color: #1d1d1f; margin-bottom: 6px; display: block;">密码</label>
                <input type="text" id="password" readonly style="width: 100%; padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 6px; font-size: 12px; background: #fafafa; color: #1d1d1f;">
              </div>
              
              <div class="form-group" style="margin-bottom: 12px;">
                <label style="font-size: 12px; font-weight: 500; color: #1d1d1f; margin-bottom: 6px; display: block;">API Token</label>
                <textarea id="currentToken" readonly style="width: 100%; padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 6px; font-size: 11px; background: #fafafa; color: #1d1d1f; font-family: 'SF Mono', Monaco, monospace; resize: vertical; min-height: 120px; line-height: 1.4;" placeholder="未获取"></textarea>
              </div>
              
              <button id="getTokenButton" class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 600; border-radius: 6px; background: linear-gradient(135deg, #007aff, #0056d3); border: none; margin-bottom: 8px;">
                获取此账号的 Token
              </button>
              
              <button id="copyCurrentTokenButton" class="btn btn-success" style="width: 100%; padding: 8px; font-size: 12px; font-weight: 500; border-radius: 6px; display: none;">
                复制 Token
              </button>
            </div>
            
            <div id="noAccountSelected" style="text-align: center; color: #86868b; padding: 60px 16px; font-size: 12px;">
              <div>请从左侧选择一个账号</div>
            </div>
          </div>
        </div>
        
        <!-- 批量获取进度 -->
        <div id="batchProgress" style="display: none; background: #ffffff; border: 1px solid #e5e5ea; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 600; color: #1d1d1f; margin-bottom: 10px;">批量获取进度</div>
          <div style="margin-bottom: 6px; font-size: 12px; color: #6e6e73;" id="batchProgressText">准备开始...</div>
          <div style="width: 100%; height: 6px; background: #e5e5ea; border-radius: 3px; overflow: hidden; margin-bottom: 10px;">
            <div id="batchProgressBar" style="height: 100%; background: linear-gradient(90deg, #007aff, #0056d3); width: 0%; transition: width 0.3s ease;"></div>
          </div>
          <div id="batchProgressDetails" style="font-size: 11px; color: #86868b; line-height: 1.5;"></div>
        </div>
        
        <!-- 状态信息 -->
        <div id="status" class="status" style="display: none; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; text-align: center;"></div>
        
        <!-- 日志容器 -->
        <div id="logContainer" style="display: none; background: #ffffff; border: 1px solid #e5e5ea; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 600; color: #1d1d1f; margin-bottom: 10px;">运行日志</div>
          <div id="logContent" style="
            font-family: 'SF Mono', Monaco, monospace; 
            font-size: 11px; 
            background: #fafafa; 
            padding: 10px; 
            border-radius: 6px; 
            max-height: 180px; 
            overflow-y: auto; 
            line-height: 1.5;
            color: #424245;
          "></div>
        </div>
        
        <!-- Token 结果展示 -->
        <div id="resultContainer" style="display: none; background: linear-gradient(135deg, #e6f7e6 0%, #d4edda 100%); border: 2px solid #34c759; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
          <h3 style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #1d1d1f; text-align: center;">Token 获取成功</h3>
          
          <div style="margin-bottom: 16px;">
            <label style="font-size: 12px; font-weight: 600; color: #1d1d1f; margin-bottom: 6px; display: block;">API Token</label>
            <div id="apiToken" style="
              word-break: break-all; 
              font-family: 'SF Mono', Monaco, monospace; 
              background: #ffffff; 
              padding: 12px; 
              border-radius: 6px; 
              max-height: 100px; 
              overflow-y: auto;
              font-size: 11px;
              color: #1d1d1f;
              border: 1px solid #d2d2d7;
              line-height: 1.4;
            "></div>
          </div>
          
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button id="copyButton" class="btn btn-success" style="flex: 1; max-width: 180px; padding: 8px; font-size: 13px; font-weight: 600;">
              复制 Token
            </button>
            <button id="saveButton" class="btn btn-primary" style="flex: 1; max-width: 180px; padding: 8px; font-size: 13px; font-weight: 600; display: none;">
              保存账号
            </button>
          </div>
        </div>
        
        <!-- 账号列表容器 -->
        <div id="accountListContainer" style="display: none; background: #ffffff; border: 1px solid #e5e5ea; border-radius: 8px; padding: 14px;">
          <div style="font-size: 12px; font-weight: 600; color: #1d1d1f; margin-bottom: 10px;">已获取账号列表</div>
          <div style="max-height: 180px; overflow-y: auto;"></div>
        </div>

        <!-- 配置文件信息卡片（移动到底部） -->
        <div style="background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%); border-radius: 8px; padding: 16px; margin-top: 16px; border: 1px solid #d2d2d7;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #1d1d1f;">配置文件信息</h3>
            <button id="testConfigBtn" class="btn btn-primary" style="font-size: 11px; padding: 5px 10px;">测试配置</button>
          </div>
          <div id="configInfo" style="font-family: 'SF Mono', Monaco, monospace; font-size: 10px; color: #424245; white-space: pre-wrap; line-height: 1.5; background: rgba(255,255,255,0.6); padding: 10px; border-radius: 6px; max-height: 120px; overflow-y: auto;"></div>
        </div>
      </div>
    `;
    
    // 保存DOM元素引用
    this.elements = {
      accountSwitcherContainer: container.querySelector('#accountSwitcherContainer'),
      accountList: container.querySelector('#accountList'),
      refreshButton: container.querySelector('.refresh-accounts-btn'),
      accountDetail: container.querySelector('#accountDetail'),
      noAccountSelected: container.querySelector('#noAccountSelected'),
      emailInput: container.querySelector('#email'),
      passwordInput: container.querySelector('#password'),
      currentTokenTextarea: container.querySelector('#currentToken'),
      copyCurrentTokenButton: container.querySelector('#copyCurrentTokenButton'),
      getTokenButton: container.querySelector('#getTokenButton'),
      batchGetTokenButton: container.querySelector('#batchGetTokenButton'),
      cancelBatchGetButton: container.querySelector('#cancelBatchGetButton'),
      batchProgress: container.querySelector('#batchProgress'),
      batchProgressBar: container.querySelector('#batchProgressBar'),
      batchProgressText: container.querySelector('#batchProgressText'),
      batchProgressDetails: container.querySelector('#batchProgressDetails'),
      statusDiv: container.querySelector('#status'),
      logContainer: container.querySelector('#logContainer'),
      logContent: container.querySelector('#logContent'),
      resultContainer: container.querySelector('#resultContainer'),
      apiToken: container.querySelector('#apiToken'),
      copyButton: container.querySelector('#copyButton'),
      saveButton: container.querySelector('#saveButton'),
      configInfo: container.querySelector('#configInfo'),
      testConfigBtn: container.querySelector('#testConfigBtn'),
      accountListContainer: container.querySelector('#accountListContainer')
    };
    
    // 初始化账号切换模块
    this.initAccountSwitcher();
  },
  
  // 初始化账号切换模块
  async initAccountSwitcher() {
    try {
      const AccountSwitcher = require('./accountSwitcher');
      await AccountSwitcher.initialize('accountSwitcherContainer');
    } catch (error) {
      console.error('初始化账号切换模块失败:', error);
    }
  },
  
  // 绑定事件
  bindEvents() {
    // 刷新账号列表按钮
    this.elements.refreshButton.addEventListener('click', () => this.loadAccounts());
    
    // 获取Token按钮
    this.elements.getTokenButton.addEventListener('click', () => this.getToken());
    
    // 批量获取Token按钮
    this.elements.batchGetTokenButton.addEventListener('click', () => this.batchGetTokens());
    
    // 取消批量获取按钮
    this.elements.cancelBatchGetButton.addEventListener('click', () => this.cancelBatchGet());
    
    // 复制当前Token按钮
    this.elements.copyCurrentTokenButton.addEventListener('click', () => {
      const token = this.elements.currentTokenTextarea.value;
      if (token && token !== '未获取') {
        navigator.clipboard.writeText(token)
          .then(() => {
            this.showStatus('Token已复制到剪贴板', 'success');
          })
          .catch(err => {
            this.showStatus(`复制失败: ${err}`, 'error');
          });
      }
    });
    
    // 复制Token按钮
    this.elements.copyButton.addEventListener('click', () => this.copyToken());
    
    // 保存账号按钮（已隐藏，不再提供手动保存功能）
    // this.elements.saveButton.addEventListener('click', () => this.saveAccount());
    
    // 测试配置文件按钮
    this.elements.testConfigBtn.addEventListener('click', () => this.testConfig());
  },
  
  // 测试配置文件
  async testConfig() {
    try {
      // 获取配置文件路径
      const configPath = window.ConfigManager.getConfigFilePath();
      const accountsPath = window.ConfigManager.getAccountsFilePath();
      
      // 加载配置
      const configResult = await window.ConfigManager.loadConfig();
      
      // 显示配置信息
      const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : process.platform;
      let configInfo = `当前平台: ${platform}\n`;
      configInfo += `配置文件路径: ${configPath}\n`;
      configInfo += `账号文件路径: ${accountsPath}\n\n`;
      
      if (configResult.success) {
        configInfo += `配置状态: 加载成功\n`;
        configInfo += `配置内容:\n${JSON.stringify(configResult.config, null, 2)}\n\n`;
      } else {
        configInfo += `配置状态: 加载失败 (${configResult.error})\n`;
      }
      
      // 加载账号
      const accountsResult = await window.ConfigManager.loadAccounts();
      
      if (accountsResult.success) {
        configInfo += `账号状态: 加载成功 (共${accountsResult.accounts ? accountsResult.accounts.length : 0}个账号)\n`;
      } else {
        configInfo += `账号状态: 加载失败 (${accountsResult.error})\n`;
      }
      
      // 更新显示
      this.elements.configInfo.textContent = configInfo;
      
      // 显示状态
      this.showStatus('配置文件测试完成', 'info');
    } catch (error) {
      console.error('测试配置文件失败:', error);
      this.elements.configInfo.textContent = `测试失败: ${error.message}`;
      this.showStatus(`测试配置文件失败: ${error.message}`, 'error');
    }
  },
  
  // 加载账号列表
  async loadAccounts() {
    try {
      this.showStatus('正在加载本地账号...', 'info');
      
      // 使用ConfigManager加载账号
      const result = await window.ConfigManager.loadAccounts();
      
      if (result.success && result.accounts && result.accounts.length > 0) {
        this.accountsList = result.accounts;
        
        // 清空列表并填充账号条目
        this.elements.accountList.innerHTML = '';
        
        this.accountsList.forEach((account, index) => {
          const accountItem = document.createElement('div');
          accountItem.className = 'account-item';
          accountItem.style.cssText = `
            padding: 12px 14px;
            border-bottom: 1px solid #e5e5ea;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #ffffff;
          `;
          
          // 账号信息显示
          const accountInfo = document.createElement('div');
          accountInfo.style.cssText = 'flex: 1; min-width: 0;';
          const tokenExpired = this.isTokenExpired(account);
          const tokenStatusText = account.apiKey
            ? (tokenExpired ? '• Token已过期' : '• 已获取 Token')
            : '• 待获取 Token';
          accountInfo.innerHTML = `
            <div style="font-weight: 600; color: #1d1d1f; font-size: 13px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <span class="account-email">${account.email}</span>
            </div>
            <div style="font-size: 11px; color: #86868b; line-height: 1.4;">
              ${account.password ? '已保存密码' : '未保存密码'} ${tokenStatusText}
              <span class="account-plan" style="margin-left: 8px; color: #007aff;">-</span>
              <span class="account-credits" style="margin-left: 8px; color: #34c759;">-/-</span>
            </div>
          `;
          
          // 状态标识
          const statusBadge = document.createElement('span');
          statusBadge.style.cssText = `
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
            margin-left: 12px;
          `;
          
          if (account.apiKey) {
            if (tokenExpired) {
              statusBadge.textContent = '!';
              statusBadge.style.backgroundColor = '#fff3cd';
              statusBadge.style.color = '#856404';
              statusBadge.style.border = '1px solid #ffeaa7';
            } else {
              statusBadge.textContent = '';
              statusBadge.style.backgroundColor = '#d4edda';
              statusBadge.style.color = '#155724';
              statusBadge.style.border = '1px solid #c3e6cb';
            }
          } else {
            statusBadge.textContent = '⋯';
            statusBadge.style.backgroundColor = '#fff3cd';
            statusBadge.style.color = '#856404';
            statusBadge.style.border = '1px solid #ffeaa7';
          }
          
          // 切换按钮
          const switchButton = document.createElement('button');
          switchButton.className = 'switch-account-btn';
          switchButton.textContent = '切换';
          switchButton.style.cssText = `
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            background: #007aff;
            color: white;
            border: none;
            cursor: pointer;
            margin-left: 8px;
            white-space: nowrap;
            transition: all 0.2s ease;
          `;
          switchButton.onclick = (e) => {
            e.stopPropagation();
            switchToAccount(account.id);
          };
          switchButton.onmouseenter = () => {
            if (!switchButton.disabled) {
              switchButton.style.background = '#0051d5';
            }
          };
          switchButton.onmouseleave = () => {
            if (!switchButton.disabled) {
              switchButton.style.background = '#007aff';
            }
          };
          
          accountItem.appendChild(accountInfo);
          accountItem.appendChild(statusBadge);
          accountItem.appendChild(switchButton);
          
          // 保存账号引用
          accountItem._accountData = account;
          accountItem.classList.add('account-card');
          
          // 添加点击事件
          accountItem.addEventListener('click', () => this.selectAccount(account, accountItem));
          
          // 添加悬停效果
          accountItem.addEventListener('mouseenter', () => {
            accountItem.style.backgroundColor = '#f5f5f7';
            accountItem.style.transform = 'translateX(4px)';
          });
          
          accountItem.addEventListener('mouseleave', () => {
            if (!accountItem.classList.contains('selected')) {
              accountItem.style.backgroundColor = '#ffffff';
            }
            accountItem.style.transform = 'translateX(0)';
          });
          
          this.elements.accountList.appendChild(accountItem);
        });
        
        this.showStatus(`成功加载 ${this.accountsList.length} 个本地账号`, 'success');
        
        // 输出配置文件路径
        console.log('配置文件路径:', window.ConfigManager.getConfigFilePath());
        console.log('账号文件路径:', window.ConfigManager.getAccountsFilePath());
        
        // 自动查询订阅和积分
        setTimeout(() => {
          if (typeof updateAccountsUsage === 'function') {
            updateAccountsUsage();
          }
        }, 1000);
      } else {
        // 显示占位符
        this.elements.accountList.innerHTML = `
          <div class="account-list-placeholder" style="
            text-align: center; 
            color: #999; 
            padding: 20px; 
            font-style: italic;
          ">暂无本地账号，请先注册或手动输入账号信息</div>
        `;
        this.showStatus('未找到本地账号，请手动输入', 'info');
      }
    } catch (error) {
      this.showStatus(`加载账号失败: ${error.message}`, 'error');
      console.error('加载账号失败:', error);
    }
  },
  
  // 选择账号
  selectAccount(account, itemElement) {
    if (!account) return;
    
    // 清除之前选中的状态
    const allItems = this.elements.accountList.querySelectorAll('.account-item');
    allItems.forEach(item => {
      item.style.backgroundColor = '#ffffff';
      item.style.border = '';
      item.classList.remove('selected');
    });
    
    // 设置当前选中的状态
    if (itemElement) {
      itemElement.style.backgroundColor = '#e6f7ff';
      itemElement.style.border = '2px solid #007aff';
      itemElement.classList.add('selected');
    }
    
    // 隐藏"请选择账号"提示，显示账号详情区域
    this.elements.noAccountSelected.style.display = 'none';
    this.elements.accountDetail.style.display = 'block';
    
    // 填充表单（只读，显示明文密码）
    this.elements.emailInput.value = account.email;
    this.elements.passwordInput.value = account.password || '（未保存密码）';
    
    // 显示已有的Token（如果存在）
    if (account.apiKey) {
      this.elements.currentTokenTextarea.value = account.apiKey;
      this.elements.copyCurrentTokenButton.style.display = 'block';
    } else {
      this.elements.currentTokenTextarea.value = '';
      this.elements.currentTokenTextarea.placeholder = '未获取';
      this.elements.copyCurrentTokenButton.style.display = 'none';
    }
    
    // 保存当前选中的账号
    this.selectedAccount = account;
    
    this.showStatus(`已选择账号: ${account.email}`, 'info');
  },
  
  // 批量获取Token
  async batchGetTokens() {
    // 只处理未获取Token或Token已过期的账号
    const accountsToProcess = this.accountsList.filter(acc => {
      if (!acc.password) return false; // 没密码没法自动登录
      if (!acc.apiKey) return true;    // 没有Token
      return this.isTokenExpired(acc); // Token已过期
    });
    
    if (accountsToProcess.length === 0) {
      this.showStatus('没有需要获取Token的账号（所有账号已获取或缺少密码）', 'info');
      return;
    }
    
    this.showStatus(`准备批量获取 ${accountsToProcess.length} 个账号的Token`, 'info');
    
    this.elements.batchProgress.style.display = 'block';
    this.elements.batchGetTokenButton.style.display = 'none';
    this.elements.cancelBatchGetButton.style.display = 'inline-block';
    
    this.batchGetCancelled = false;
    this.batchGetResults = {
      total: accountsToProcess.length,
      success: 0,
      failed: 0,
      processed: 0
    };
    
    const updateProgress = () => {
      const progress = (this.batchGetResults.processed / this.batchGetResults.total) * 100;
      this.elements.batchProgressBar.style.width = `${progress}%`;
      this.elements.batchProgressText.textContent = 
        `进度: ${this.batchGetResults.processed}/${this.batchGetResults.total} | 成功: ${this.batchGetResults.success} | 失败: ${this.batchGetResults.failed}`;
    };
    
    // 顺序执行，确保不会同时打开多个浏览器
    for (let i = 0; i < accountsToProcess.length && !this.batchGetCancelled; i++) {
      const account = accountsToProcess[i];
      
      this.elements.batchProgressDetails.textContent = `正在处理第 ${i + 1}/${accountsToProcess.length} 个账号: ${account.email}`;
      
      try {
        console.log(`\n========== 开始处理第 ${i + 1}/${accountsToProcess.length} 个账号 ==========`);
        console.log(`账号: ${account.email}`);
        console.log(`时间: ${new Date().toLocaleString()}`);
        
        const result = await window.ipcRenderer.invoke('get-account-token', {
          email: account.email,
          password: account.password
        });
        
        if (result.success) {
          this.batchGetResults.success++;
          console.log(`账号 ${account.email} Token获取成功`);
          
          await window.ConfigManager.updateAccount({
            id: account.id,
            apiKey: result.token,
            tokenUpdatedAt: new Date().toISOString()
          });
          
          account.apiKey = result.token;
          
          // 每个账号成功后即时刷新列表，让“已获取 Token”状态实时更新
          try {
            await this.loadAccounts();
          } catch (e) {
            console.error('批量获取后刷新账号列表失败:', e);
          }
        } else {
          this.batchGetResults.failed++;
          console.error(`账号 ${account.email} Token获取失败: ${result.error}`);
        }
      } catch (error) {
        this.batchGetResults.failed++;
        console.error(`账号 ${account.email} 处理出错: ${error.message}`);
      } finally {
        this.batchGetResults.processed++;
        updateProgress();
        
        console.log(`========== 完成处理第 ${i + 1}/${accountsToProcess.length} 个账号 ==========\n`);
      }
      
      // 在处理下一个账号之前添加延迟，避免数据错乱
      if (i < accountsToProcess.length - 1 && !this.batchGetCancelled) {
        const delaySeconds = 15; // 延迟15秒，确保上一个浏览器完全关闭
        console.log(`等待${delaySeconds}秒后继续下一个账号...`);
        this.elements.batchProgressDetails.textContent = `等待${delaySeconds}秒后继续下一个账号...`;
        
        // 倒计时显示
        for (let countdown = delaySeconds; countdown > 0 && !this.batchGetCancelled; countdown--) {
          this.elements.batchProgressDetails.textContent = `等待 ${countdown} 秒后继续下一个账号...`;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    this.elements.cancelBatchGetButton.style.display = 'none';
    this.elements.batchGetTokenButton.style.display = 'inline-block';
    
    if (this.batchGetCancelled) {
      this.showStatus(`批量获取已取消 (成功: ${this.batchGetResults.success}, 失败: ${this.batchGetResults.failed})`, 'info');
    } else {
      this.showStatus(
        `批量获取完成！成功: ${this.batchGetResults.success}, 失败: ${this.batchGetResults.failed}`, 
        this.batchGetResults.failed === 0 ? 'success' : 'info'
      );
    }
    
    await this.loadAccounts();
  },
  
  // 取消批量获取
  cancelBatchGet() {
    this.batchGetCancelled = true;
    this.showStatus('正在取消批量获取...', 'info');
  },
  
  // 获取Token
  async getToken() {
    const email = this.elements.emailInput.value.trim();
    const password = this.elements.passwordInput.value.trim();
    
    if (!email) {
      this.showStatus('请输入邮箱账号或选择本地账号', 'error');
      return;
    }
    
    if (!password) {
      this.showStatus('请输入密码', 'error');
      return;
    }
    
    // 禁用按钮
    this.elements.getTokenButton.disabled = true;
    this.elements.getTokenButton.textContent = '获取中...';
    
    // 清空之前的日志
    this.elements.logContent.innerHTML = '';
    this.elements.logContainer.style.display = 'block';
    
    this.showStatus('正在获取Token，请稍候...', 'info');
    
    try {
      this.log('开始获取Token流程');
      this.log(`账号: ${email}`);
      
      // 使用已选择的账号
      const selectedAccount = this.selectedAccount;
      
      // 显示当前平台
      const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : process.platform;
      this.log(`当前平台: ${platform}`);
      
      // 调用主进程方法获取token
      this.log(`正在使用${platform}平台的方式获取token...`);
      const result = await ipcRenderer.invoke('get-account-token', {
        email,
        password
      });
      
      if (result.success) {
        this.log('Token获取成功!');
        this.showStatus('Token获取成功!', 'success');
        
        // 更新右侧账号详情的Token显示
        this.elements.currentTokenTextarea.value = result.token;
        this.elements.copyCurrentTokenButton.style.display = 'block';
        
        // 显示结果容器
        this.elements.apiToken.textContent = result.token;
        this.elements.resultContainer.style.display = 'block';
        
        // 显示格式化的账号信息（一行一个）
        this.log('\n============================================================');
        this.log('账号信息（一行一个）');
        this.log('============================================================');
        this.log(`账号 ${result.email}|密码 ${result.password}|Token ${result.apiKey || result.token}`);
        this.log('============================================================\n');
        
        // 如果有用户名信息，显示用户名
        if (result.username) {
          this.log(`用户名: ${result.username}`);
        }
        
        // 保存token到本地账号数据
        if (selectedAccount) {
          // 如果是从本地账号选择的，更新该账号
          this.log('正在更新本地账号的API密钥...');
          try {
            // 使用ConfigManager更新账号
            const updateResult = await window.ConfigManager.updateAccount({
              id: selectedAccount.id,
              apiKey: result.token,
              tokenUpdatedAt: new Date().toISOString()
            });
            
            if (updateResult.success) {
              this.log('API密钥已更新到本地账号');
              // 更新本地账号对象
              selectedAccount.apiKey = result.token;
              // 刷新账号列表显示
              await this.loadAccounts();
              // 重新选择当前账号
              const allItems = this.elements.accountList.querySelectorAll('.account-item');
              allItems.forEach(item => {
                if (item._accountData && item._accountData.id === selectedAccount.id) {
                  this.selectAccount(selectedAccount, item);
                }
              });
            } else {
              this.log(`❗ 更新API密钥失败: ${updateResult.error}`);
            }
          } catch (updateError) {
            this.log(`❗ 更新API密钥失败: ${updateError.message}`);
          }
        } else {
          // 如果是手动输入的账号，仅在本地已存在时更新，不再自动新增账号
          this.log('检查该账号是否已存在于本地（仅更新已存在账号，不新增）...');
          try {
            const existingAccount = this.accountsList.find(acc => acc.email === email);
            
            if (existingAccount) {
              this.log('账号已存在，更新API密钥...');
              
              const updateResult = await window.ConfigManager.updateAccount({
                id: existingAccount.id,
                apiKey: result.token,
                tokenUpdatedAt: new Date().toISOString()
              });
              
              if (updateResult.success) {
                this.log('API密钥已更新到本地账号');
                await this.loadAccounts();

                // 刷新后在本地账号列表中自动选中该账号
                const allItems = this.elements.accountList.querySelectorAll('.account-item');
                allItems.forEach(item => {
                  if (item._accountData && item._accountData.id === existingAccount.id) {
                    this.selectAccount(item._accountData, item);
                  }
                });
              } else {
                this.log(`❗ 更新API密钥失败: ${updateResult.error}`);
              }
            } else {
              this.log('本地未找到该账号记录，本次仅显示Token，不自动新增账号。');
            }
          } catch (error) {
            this.log(`❗ 保存账号失败: ${error.message}`);
          }
        }
      } else {
        this.log(`获取失败: ${result.error}`);
        this.showStatus(`获取失败: ${result.error}`, 'error');
      }
    } catch (error) {
      this.log(`发生错误: ${error.message}`);
      this.showStatus(`发生错误: ${error.message}`, 'error');
    } finally {
      // 恢复按钮状态
      this.elements.getTokenButton.disabled = false;
      this.elements.getTokenButton.textContent = '获取Token';
    }
  },
  
  // 复制Token到剪贴板
  copyToken() {
    const token = this.elements.apiToken.textContent;
    
    if (token) {
      navigator.clipboard.writeText(token)
        .then(() => {
          this.showStatus('Token已复制到剪贴板', 'success');
        })
        .catch(err => {
          this.showStatus(`复制失败: ${err}`, 'error');
        });
    }
  },
  
  // 保存账号信息
  async saveAccount() {
    const email = this.elements.emailInput.value.trim();
    const token = this.elements.apiToken.textContent;
    
    if (!email || !token) {
      this.showStatus('账号信息不完整，无法保存', 'error');
      return;
    }
    
    try {
      // 使用ConfigManager添加账号
      const result = await window.ConfigManager.addAccount({
        email,
        apiKey: token,
        name: email.split('@')[0]
      });
      
      if (result.success) {
        this.showStatus('账号信息已保存', 'success');
        // 重新加载账号列表
        await this.loadAccounts();
      } else {
        this.showStatus(`保存失败: ${result.error}`, 'error');
      }
    } catch (error) {
      this.showStatus(`保存失败: ${error.message}`, 'error');
    }
  },
  
  // 显示状态信息
  showStatus(message, type) {
    this.elements.statusDiv.textContent = message;
    this.elements.statusDiv.style.display = 'block';
    
    // 根据类型设置样式
    if (type === 'success') {
      this.elements.statusDiv.style.background = '#d4edda';
      this.elements.statusDiv.style.color = '#155724';
      this.elements.statusDiv.style.border = '1px solid #c3e6cb';
    } else if (type === 'error') {
      this.elements.statusDiv.style.background = '#f8d7da';
      this.elements.statusDiv.style.color = '#721c24';
      this.elements.statusDiv.style.border = '1px solid #f5c6cb';
    } else if (type === 'info') {
      this.elements.statusDiv.style.background = '#d1ecf1';
      this.elements.statusDiv.style.color = '#0c5460';
      this.elements.statusDiv.style.border = '1px solid #bee5eb';
    }
  },
  
  // 日志记录函数
  log(message) {
    const logEntry = document.createElement('div');
    logEntry.style.cssText = 'margin-bottom: 4px; padding: 4px 0;';
    
    // 检查是否是账号信息格式（纯文字版本）
    if (message.includes('账号 ') && message.includes('|密码')) {
      // 将账号信息添加到账号列表容器
      this.addToAccountList(message);
      logEntry.textContent = message;
      logEntry.style.color = '#007aff';
      logEntry.style.fontWeight = '600';
    } else if (message.includes('成功') && !message.includes('失败')) {
      logEntry.textContent = message;
      logEntry.style.color = '#34c759';
      logEntry.style.fontWeight = '600';
    } else if (message.includes('失败') || message.includes('错误')) {
      logEntry.textContent = message;
      logEntry.style.color = '#ff3b30';
      logEntry.style.fontWeight = '600';
    } else if (message.includes('====')) {
      logEntry.textContent = message;
      logEntry.style.color = '#86868b';
    } else {
      logEntry.textContent = message;
      logEntry.style.color = '#424245';
    }
    
    this.elements.logContent.appendChild(logEntry);
    this.elements.logContent.scrollTop = this.elements.logContent.scrollHeight;
  },
  
  // 添加账号到账号列表
  addToAccountList(accountInfo) {
    // 如果是账号信息的分隔线，忽略
    if (accountInfo.includes('============================')) {
      return;
    }
    
    // 如果是标题行，忽略
    if (accountInfo.includes('账号信息') && !accountInfo.includes('|密码')) {
      return;
    }
    
    // 提取账号信息
    const match = accountInfo.match(/账号\s+([^|]+)\|密码\s+([^|]+)\|Token\s+(.+)/);
    if (match) {
      const email = match[1].trim();
      const password = match[2].trim();
      const apiKey = match[3].trim();
      
      // 显示账号列表容器
      this.elements.accountListContainer.style.display = 'block';
      
      // 创建账号条目
      const accountItem = document.createElement('div');
      accountItem.style.cssText = `
        padding: 12px 16px; 
        border-bottom: 1px solid #e5e5ea; 
        font-family: 'SF Mono', Monaco, monospace; 
        background: #fafafa;
        border-radius: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      
      accountItem.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: #007aff; font-weight: 600; font-size: 13px;">账号: ${email}</span>
          <span style="color: #86868b; font-size: 11px;">点击复制</span>
        </div>
        <div style="font-size: 11px; color: #6e6e73; line-height: 1.6;">
          <div style="margin-bottom: 4px;">密码: ${password}</div>
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Token: ${apiKey.substring(0, 40)}...</div>
        </div>
      `;
      
      // 添加复制功能
      accountItem.title = '点击复制完整信息';
      accountItem.onclick = () => {
        navigator.clipboard.writeText(`${email}|${password}|${apiKey}`)
          .then(() => {
            accountItem.style.backgroundColor = '#d4edda';
            accountItem.style.border = '2px solid #34c759';
            setTimeout(() => {
              accountItem.style.backgroundColor = '#fafafa';
              accountItem.style.border = '';
            }, 1000);
          });
      };
      
      // 悬停效果
      accountItem.addEventListener('mouseenter', () => {
        accountItem.style.backgroundColor = '#e6f7ff';
        accountItem.style.transform = 'translateX(4px)';
      });
      
      accountItem.addEventListener('mouseleave', () => {
        accountItem.style.backgroundColor = '#fafafa';
        accountItem.style.transform = 'translateX(0)';
      });
      
      // 添加到容器的第一个子元素
      const listContainer = this.elements.accountListContainer.querySelector('div');
      if (listContainer) {
        listContainer.insertBefore(accountItem, listContainer.firstChild);
      } else {
        this.elements.accountListContainer.appendChild(accountItem);
      }
    }
  },
};

// 导出模块
module.exports = TokenGetter;
