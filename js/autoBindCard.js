/**
 * 自动绑卡模块
 * 支持获取绑卡链接、打开系统浏览器、自定义账单信息和虚拟卡
 */

const AutoBindCard = {
  // 当前选中的账号
  selectedAccount: null,
  
  // 绑卡配置
  config: {
    // 填写模式: 'manual' = 手动填写, 'auto' = 自动填写
    fillMode: 'manual',
    
    // 账单信息
    billingName: '',
    billingCountry: 'CN',
    billingState: '',  // 省/州
    billingCity: '',
    billingDistrict: '',  // 地区
    billingAddress: '',
    billingAddress2: '',  // 地址第2行
    billingPostalCode: '',
    
    // 虚拟卡配置
    cardMode: 'bin', // 'bin' = 使用卡号段生成, 'full' = 完整卡信息
    cardBin: '559888035xxxxxxx',
    cardNumber: '',
    cardExpMonth: '',
    cardExpYear: '',
    cardCvv: ''
  },

  // 每日使用限制
  dailyLimit: 50,
  
  // 缓存使用次数数据
  usageData: { date: '', count: 0 },

  /**
   * 获取今天的日期字符串 (YYYY-MM-DD)
   */
  getTodayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  /**
   * 从配置文件加载使用次数
   */
  async loadUsageFromConfig() {
    try {
      const config = await window.ipcRenderer.invoke('load-windsurf-config');
      console.log('加载配置文件:', config);
      const today = this.getTodayStr();
      if (config && config.autoBindUsage && config.autoBindUsage.date === today) {
        this.usageData = config.autoBindUsage;
        console.log('加载使用次数成功:', this.usageData);
      } else {
        // 日期不同或无数据，重置计数
        this.usageData = { date: today, count: 0 };
        console.log('使用次数重置（日期不同或无数据）:', this.usageData);
      }
    } catch (e) {
      console.error('加载使用次数失败:', e);
      this.usageData = { date: this.getTodayStr(), count: 0 };
    }
  },

  /**
   * 保存使用次数到配置文件
   */
  async saveUsageToConfig() {
    try {
      let config = await window.ipcRenderer.invoke('load-windsurf-config');
      // 确保 config 是对象
      if (!config || typeof config !== 'object') {
        config = {};
      }
      config.autoBindUsage = this.usageData;
      const result = await window.ipcRenderer.invoke('save-windsurf-config', config);
      console.log('保存使用次数:', this.usageData, '结果:', result);
    } catch (e) {
      console.error('保存使用次数失败:', e);
    }
  },

  /**
   * 获取今日使用次数
   */
  getTodayUsage() {
    const today = this.getTodayStr();
    if (this.usageData.date === today) {
      return this.usageData.count || 0;
    }
    return 0;
  },

  /**
   * 增加今日使用次数
   */
  async incrementUsage() {
    const today = this.getTodayStr();
    if (this.usageData.date !== today) {
      this.usageData = { date: today, count: 0 };
    }
    this.usageData.count++;
    await this.saveUsageToConfig();
  },

  /**
   * 检查是否超过每日限制
   */
  isLimitExceeded() {
    return this.getTodayUsage() >= this.dailyLimit;
  },

  /**
   * 获取距离明天0点的剩余时间（毫秒）
   */
  getTimeUntilReset() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
  },

  /**
   * 格式化剩余时间
   */
  formatTimeRemaining(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  },

  /**
   * 显示限制弹窗（不可关闭）
   */
  showLimitModal() {
    // 移除已存在的弹窗
    const existing = document.getElementById('bindCardLimitModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'bindCardLimitModal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.9); z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px);
    `;

    modal.innerHTML = `
      <div style="background: white; border-radius: 16px; padding: 32px; max-width: 400px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.25);">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #ef4444, #dc2626); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
          <i data-lucide="alert-circle" style="width: 32px; height: 32px; color: white;"></i>
        </div>
        <h3 style="font-size: 20px; font-weight: 700; color: #1e293b; margin: 0 0 12px;">今日使用次数已达上限</h3>
        <p style="font-size: 14px; color: #64748b; margin: 0 0 20px; line-height: 1.5;">
          每天限制使用 <strong style="color: #ef4444;">${this.dailyLimit}</strong> 次绑卡功能<br>
          请等待重置后再试
        </p>
        <div style="background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">距离重置还有</div>
          <div id="limitCountdown" style="font-size: 36px; font-weight: 700; color: #2563eb; font-family: 'SF Mono', Monaco, monospace;">
            ${this.formatTimeRemaining(this.getTimeUntilReset())}
          </div>
        </div>
        <div style="font-size: 12px; color: #94a3b8;">
          今日已使用: <strong style="color: #1e293b;">${this.getTodayUsage()}</strong> / ${this.dailyLimit} 次
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    
    // 初始化图标
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // 启动倒计时
    this.startCountdown();
  },

  /**
   * 启动倒计时
   */
  startCountdown() {
    // 清除旧的定时器
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    
    this.countdownTimer = setInterval(() => {
      const remaining = this.getTimeUntilReset();
      const countdownEl = document.getElementById('limitCountdown');
      
      if (remaining <= 0) {
        // 时间到，移除弹窗
        clearInterval(this.countdownTimer);
        const modal = document.getElementById('bindCardLimitModal');
        if (modal) modal.remove();
        // 刷新页面
        if (typeof showCenterMessage === 'function') {
          showCenterMessage('限制已重置，可以继续使用', 'success');
        }
      } else if (countdownEl) {
        countdownEl.textContent = this.formatTimeRemaining(remaining);
      }
    }, 1000);
  },

  /**
   * 隐藏限制弹窗
   */
  hideLimitModal() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    const modal = document.getElementById('bindCardLimitModal');
    if (modal) modal.remove();
  },
  
  // 各国家地址数据
  countryData: {
    // 中国
    CN: {
      name: '中国',
      hasProvince: true,
      hasDistrict: true,
      hasPostalCode: true,
      provinceLabel: '省/州',
      cityLabel: '城市',
      districtLabel: '地区',
      provinces: ['广东省', '北京市', '上海市', '浙江省', '江苏省', '四川省', '湖北省', '湖南省', '山东省', '福建省', '安徽省', '河南省', '河北省', '辽宁省', '陕西省', '天津市', '重庆市']
    },
    // 香港
    HK: {
      name: '香港',
      hasProvince: true,
      hasDistrict: false,
      hasPostalCode: false,
      provinceLabel: '地区',
      cityLabel: '地区',
      districtLabel: '',
      provinces: ['Kowloon', 'Hong Kong', 'New Territories'],
      provinceNames: { 'Kowloon': '九龍', 'Hong Kong': '香港島', 'New Territories': '新界' }
    },
    // 美国
    US: {
      name: '美国',
      hasProvince: true,
      hasDistrict: false,
      hasPostalCode: true,
      provinceLabel: '州/省',
      cityLabel: '城市',
      districtLabel: '',
      provinces: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'],
      provinceNames: {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
        'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'DC': 'District of Columbia', 'FL': 'Florida',
        'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana',
        'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
        'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire',
        'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota',
        'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
        'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
      },
      cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose'],
      postalCodes: ['10001', '90001', '60601', '77001', '85001', '19101', '78201', '92101', '75201', '95101']
    }
  },

  // 中国省份和城市数据
  chinaProvinces: [
    { name: '广东省', cities: ['广州', '深圳', '东莞', '佛山', '珠海'], districts: ['天河区', '福田区', '南城区', '禅城区', '香洲区'], postalCodes: ['510000', '518000', '523000', '528000', '519000'] },
    { name: '北京市', cities: ['北京'], districts: ['朝阳区', '海淀区', '西城区', '东城区'], postalCodes: ['100000'] },
    { name: '上海市', cities: ['上海'], districts: ['浦东新区', '黄浦区', '徐汇区', '静安区'], postalCodes: ['200000'] },
    { name: '浙江省', cities: ['杭州', '宁波', '温州', '嘉兴'], districts: ['西湖区', '江北区', '鹿城区', '南湖区'], postalCodes: ['310000', '315000', '325000', '314000'] },
    { name: '江苏省', cities: ['南京', '苏州', '无锡', '常州'], districts: ['玄武区', '姑苏区', '锡山区', '天宁区'], postalCodes: ['210000', '215000', '214000', '213000'] },
    { name: '四川省', cities: ['成都', '绵阳', '德阳'], districts: ['武侯区', '涪城区', '旌阳区'], postalCodes: ['610000', '621000', '618000'] },
    { name: '湖北省', cities: ['武汉', '宜昌', '襄阳'], districts: ['武昌区', '西陵区', '襄城区'], postalCodes: ['430000', '443000', '441000'] },
    { name: '湖南省', cities: ['长沙', '株洲', '湘潭'], districts: ['芙蓉区', '天元区', '雨湖区'], postalCodes: ['410000', '412000', '411000'] },
    { name: '山东省', cities: ['济南', '青岛', '烟台'], districts: ['历下区', '市南区', '芝罘区'], postalCodes: ['250000', '266000', '264000'] },
    { name: '福建省', cities: ['福州', '厦门', '泉州'], districts: ['鼓楼区', '思明区', '丰泽区'], postalCodes: ['350000', '361000', '362000'] },
    { name: '安徽省', cities: ['合肥', '芜湖', '蚌埠'], districts: ['包河区', '镜湖区', '蚌山区'], postalCodes: ['230000', '241000', '233000'] },
    { name: '河南省', cities: ['郑州', '洛阳', '开封'], districts: ['金水区', '洛龙区', '龙亭区'], postalCodes: ['450000', '471000', '475000'] },
    { name: '河北省', cities: ['石家庄', '唐山', '秦皇岛'], districts: ['长安区', '路北区', '海港区'], postalCodes: ['050000', '063000', '066000'] },
    { name: '辽宁省', cities: ['沈阳', '大连', '鞍山'], districts: ['和平区', '中山区', '铁东区'], postalCodes: ['110000', '116000', '114000'] },
    { name: '陕西省', cities: ['西安', '咸阳', '宝鸡'], districts: ['雁塔区', '秦都区', '金台区'], postalCodes: ['710000', '712000', '721000'] },
    { name: '天津市', cities: ['天津'], districts: ['和平区', '南开区', '河西区'], postalCodes: ['300000'] },
    { name: '重庆市', cities: ['重庆'], districts: ['渝中区', '江北区', '沙坪坝区'], postalCodes: ['400000'] }
  ],
  
  // 各国姓名数据
  nameData: {
    // 中国名字
    CN: {
      surnames: ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高'],
      givenNames: ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '秀英', '桂英', '建华', '志强', '文杰', '晓明', '雪梅', '春华'],
      format: 'surname_first' // 姓在前
    },
    // 香港名字（中英混合）
    HK: {
      surnames: ['Chan', 'Wong', 'Lee', 'Lam', 'Cheung', 'Ho', 'Ng', 'Leung', 'Yip', 'Fung', 'Tsang', 'Chow', 'Tang', 'Yeung', 'Kwok'],
      givenNames: ['Wing', 'Wai', 'Chi', 'Kin', 'Man', 'Hoi', 'Yee', 'Mei', 'Siu', 'Pak', 'Kai', 'Ming', 'Fai', 'Ying', 'Tak'],
      format: 'given_first' // 名在前
    },
    // 美国名字
    US: {
      surnames: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore'],
      givenNames: ['James', 'John', 'Robert', 'Michael', 'David', 'William', 'Richard', 'Joseph', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Emma', 'Olivia', 'Ava'],
      format: 'given_first' // 名在前
    }
  },
  
  // 兼容旧代码
  chineseNames: {
    surnames: ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高'],
    givenNames: ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '秀英', '桂英', '建华', '志强', '文杰', '晓明', '雪梅', '春华']
  },
  
  // 街道名称
  streetNames: ['建国路', '人民路', '中山路', '解放路', '和平路', '胜利路', '文化路', '新华路', '光明路', '幸福路', '长安街', '南京路', '淮海路'],

  /**
   * 初始化模块
   */
  async init() {
    await this.loadConfig();
    // 初始化卡号段验证状态
    setTimeout(() => {
      const binInput = document.getElementById('autoBindCardBin');
      if (binInput) {
        binInput.value = this.config.cardBin || '559888035xxxxxxx';
        this.validateCardBin(binInput);
      }
    }, 100);
  },

  /**
   * 加载配置（从 windsurf-app-config.json）
   */
  async loadConfig() {
    try {
      // 先从 localStorage 加载（兼容旧数据）
      const saved = localStorage.getItem('autoBindCardConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.config = { ...this.config, ...parsed };
      }
      
      // 再从 JSON 文件加载（优先级更高）
      if (window.ipcRenderer) {
        const result = await window.ipcRenderer.invoke('load-windsurf-config');
        if (result.success && result.config && result.config.autoBindCard) {
          const fileConfig = result.config.autoBindCard;
          // 只覆盖存在的字段
          if (fileConfig.cardBin) this.config.cardBin = fileConfig.cardBin;
          if (fileConfig.billingCountry) this.config.billingCountry = fileConfig.billingCountry;
          console.log('已从配置文件加载绑卡设置, 卡号段:', this.config.cardBin);
        }
      }
    } catch (e) {
      console.error('加载绑卡配置失败:', e);
    }
  },

  /**
   * 保存配置（到 windsurf-app-config.json）
   */
  async saveConfig() {
    try {
      // 保存到 localStorage（兼容）
      localStorage.setItem('autoBindCardConfig', JSON.stringify(this.config));
      
      // 保存到 JSON 文件
      if (window.ipcRenderer) {
        // 先读取现有配置
        const result = await window.ipcRenderer.invoke('load-windsurf-config');
        const existingConfig = result.success ? result.config : {};
        
        // 合并绑卡配置
        existingConfig.autoBindCard = {
          cardBin: this.config.cardBin,
          billingCountry: this.config.billingCountry
        };
        
        // 保存
        await window.ipcRenderer.invoke('save-windsurf-config', existingConfig);
        console.log('绑卡设置已保存到配置文件, 卡号段:', this.config.cardBin);
      }
    } catch (e) {
      console.error('保存绑卡配置失败:', e);
    }
  },

  /**
   * 验证卡号段格式并更新提示
   * 标准卡号为16位（部分卡可能是15或19位）
   */
  validateCardBin(input) {
    const value = input.value.replace(/\s/g, ''); // 去除空格
    const length = value.length;
    const lengthEl = document.getElementById('autoBindCardBinLength');
    const statusEl = document.getElementById('autoBindCardBinStatus');
    
    if (!lengthEl) return;
    
    // 检查是否只包含数字和x
    const validChars = /^[0-9xX]+$/.test(value);
    
    // 更新长度显示
    lengthEl.textContent = `${length}/16`;
    
    if (length === 16 && validChars) {
      // 正确：16位
      lengthEl.style.color = '#4CAF50';
      input.style.borderColor = '';
    } else if (length === 15 && validChars) {
      // 警告：15位（美国运通卡）
      lengthEl.style.color = '#FF9800';
      lengthEl.textContent = `${length}/16 (美运通15位)`;
      input.style.borderColor = '#FF9800';
    } else if (length === 19 && validChars) {
      // 警告：19位（部分银联卡）
      lengthEl.style.color = '#FF9800';
      lengthEl.textContent = `${length}/16 (银联19位)`;
      input.style.borderColor = '#FF9800';
    } else if (length < 16) {
      // 错误：位数不足
      lengthEl.style.color = '#f44336';
      lengthEl.textContent = `${length}/16 (不足)`;
      input.style.borderColor = '#f44336';
    } else if (length > 16 && length !== 19) {
      // 错误：位数过多
      lengthEl.style.color = '#f44336';
      lengthEl.textContent = `${length}/16 (过多)`;
      input.style.borderColor = '#f44336';
    } else if (!validChars) {
      // 错误：包含非法字符
      lengthEl.style.color = '#f44336';
      lengthEl.textContent = `${length}/16 (含非法字符)`;
      input.style.borderColor = '#f44336';
    }
    
    // 同步更新配置
    this.config.cardBin = value;
  },

  /**
   * Luhn算法计算校验位
   */
  luhnChecksum(cardNumber) {
    const digits = cardNumber.split('').map(Number);
    let sum = 0;
    let isEven = false;
    
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = digits[i];
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      isEven = !isEven;
    }
    
    return sum % 10;
  },

      normalizeFullCardInfo(cardInfo = {}) {
        const cardNumber = String(cardInfo.cardNumber || '').replace(/\D/g, '');
        let month = String(cardInfo.month || '').replace(/\D/g, '');
        let year = String(cardInfo.year || '').replace(/\D/g, '');
        const cvv = String(cardInfo.cvv || '').replace(/\D/g, '');

        if (month.length === 1) {
          month = '0' + month;
        }

        if (year.length === 4) {
          year = year.slice(-2);
        }

        return { cardNumber, month, year, cvv };
      },

      validateFullCardInfo(cardInfo = {}, options = {}) {
        const normalized = this.normalizeFullCardInfo(cardInfo);
        const { cardNumber, month, year, cvv } = normalized;
        const showMessage = options.showMessage !== false;

        let error = '';

        if (!cardNumber || !month || !year || !cvv) {
          error = '请完整填写卡号、月份、年份和 CVV';
        } else if (cardNumber.length < 13 || cardNumber.length > 19) {
          error = '卡号必须是 13 到 19 位数字';
        } else if (this.luhnChecksum(cardNumber) !== 0) {
          error = '卡号校验失败，请检查卡号是否输入正确';
        } else if (month.length !== 2 || Number(month) < 1 || Number(month) > 12) {
          error = '月份格式错误，请填写 01 到 12';
        } else if (year.length !== 2) {
          error = '年份格式错误，请填写 YY 或 YYYY';
        } else if (cvv.length < 3 || cvv.length > 4) {
          error = 'CVV 必须是 3 或 4 位数字';
        } else {
          const now = new Date();
          const currentYear = now.getFullYear() % 100;
          const currentMonth = now.getMonth() + 1;
          const yearNumber = Number(year);
          const monthNumber = Number(month);

          if (yearNumber < currentYear || (yearNumber === currentYear && monthNumber < currentMonth)) {
            error = '这张卡看起来已经过期，请检查有效期';
          }
        }

        if (error) {
          if (showMessage && typeof showCenterMessage === 'function') {
            showCenterMessage(error, 'error');
          }

          return { success: false, error, cardInfo: normalized };
        }

        return { success: true, cardInfo: normalized };
      },

  /**
   * 根据卡号段生成完整卡号
   */
  generateCardNumber(binPattern) {
    let cardNumber = '';
    for (const char of binPattern) {
      if (char.toLowerCase() === 'x') {
        cardNumber += Math.floor(Math.random() * 10);
      } else {
        cardNumber += char;
      }
    }
    
    // 去掉最后一位，计算校验位
    cardNumber = cardNumber.slice(0, -1);
    const checksum = this.luhnChecksum(cardNumber + '0');
    const checkDigit = (10 - checksum) % 10;
    
    return cardNumber + checkDigit;
  },

  /**
   * 生成随机卡片信息
   * 算法与 Python 批量生成脚本一致
   */
  generateCardInfo() {
    const cardNumber = this.generateCardNumber(this.config.cardBin);
    // 月份: 01-12
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    // 年份: 未来1-4年
    const currentYear = new Date().getFullYear();
    const year = String(currentYear + Math.floor(Math.random() * 4) + 1).slice(-2);
    // CVV: 000-999 (3位)
    const cvv = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    
    return { cardNumber, month, year, cvv };
  },

  /**
   * 生成随机姓名（根据国家）
   */
  generateRandomName(countryCode) {
    const country = countryCode || this.config.billingCountry || 'CN';
    const nameInfo = this.nameData[country] || this.nameData['CN'];
    
    const surname = nameInfo.surnames[Math.floor(Math.random() * nameInfo.surnames.length)];
    const givenName = nameInfo.givenNames[Math.floor(Math.random() * nameInfo.givenNames.length)];
    
    // 根据国家格式组合名字
    if (nameInfo.format === 'given_first') {
      return givenName + ' ' + surname; // 英文格式：名 姓
    } else {
      return surname + givenName; // 中文格式：姓名
    }
  },

  /**
   * 生成随机地址（根据国家）
   */
  generateRandomAddress(countryCode) {
    const country = countryCode || this.config.billingCountry || 'CN';
    
    // 中国地址
    if (country === 'CN') {
      const province = this.chinaProvinces[Math.floor(Math.random() * this.chinaProvinces.length)];
      const cityIndex = Math.floor(Math.random() * province.cities.length);
      const city = province.cities[cityIndex];
      const district = province.districts[Math.floor(Math.random() * province.districts.length)];
      const postalCode = province.postalCodes[cityIndex] || province.postalCodes[0];
      const street = this.streetNames[Math.floor(Math.random() * this.streetNames.length)];
      const streetNumber = Math.floor(Math.random() * 999) + 1;
      const building = Math.floor(Math.random() * 50) + 1;
      const floor = Math.floor(Math.random() * 30) + 1;
      const room = Math.floor(Math.random() * 10) + 1;
      
      return {
        country: 'CN',
        province: province.name,
        city: city,
        district: district,
        address: `${street}${streetNumber}号`,
        address2: `${building}栋${floor}层${room}室`,
        postalCode: postalCode
      };
    }
    
    // 香港地址
    if (country === 'HK') {
      const regions = ['Kowloon', 'Hong Kong', 'New Territories'];
      const areas = ['旺角', '尖沙咀', '中环', '铜锣湾', '沙田', '荃湾', '观塘', '九龙塘'];
      const streets = ['弥敦道', '广东道', '德辅道', '轩尼诗道', '皇后大道'];
      const region = regions[Math.floor(Math.random() * regions.length)];
      const area = areas[Math.floor(Math.random() * areas.length)];
      const street = streets[Math.floor(Math.random() * streets.length)];
      const streetNumber = Math.floor(Math.random() * 500) + 1;
      const floor = Math.floor(Math.random() * 30) + 1;
      const unit = String.fromCharCode(65 + Math.floor(Math.random() * 6));
      
      return {
        country: 'HK',
        province: region,
        city: area,
        district: '',
        address: `${street}${streetNumber}号`,
        address2: `${floor}楼${unit}室`,
        postalCode: ''
      };
    }
    
    // 美国地址
    if (country === 'US') {
      const usData = this.countryData.US;
      const stateIndex = Math.floor(Math.random() * usData.provinces.length);
      const state = usData.provinces[stateIndex];
      const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Seattle'];
      const streetTypes = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Rd', 'Way', 'Ct'];
      const streetNames = ['Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Washington', 'Park', 'Lake', 'Hill'];
      const city = cities[Math.floor(Math.random() * cities.length)];
      const streetName = streetNames[Math.floor(Math.random() * streetNames.length)];
      const streetType = streetTypes[Math.floor(Math.random() * streetTypes.length)];
      const streetNumber = Math.floor(Math.random() * 9999) + 1;
      const zipCode = String(Math.floor(Math.random() * 90000) + 10000);
      
      // 随机生成地址第2行：Apt/Suite/Unit/Floor
      const aptTypes = ['Apt', 'Suite', 'Unit', 'Floor', '#'];
      const aptType = aptTypes[Math.floor(Math.random() * aptTypes.length)];
      const aptNumber = Math.floor(Math.random() * 999) + 1;
      const address2 = `${aptType} ${aptNumber}`;
      
      return {
        country: 'US',
        province: state,
        city: city,
        district: '',
        address: `${streetNumber} ${streetName} ${streetType}`,
        address2: address2,
        postalCode: zipCode
      };
    }
    
    // 默认返回中国地址
    return this.generateRandomAddress('CN');
  },

  /**
   * 打开自动绑卡弹窗
   */
  async openModal() {
    // 移除已存在的弹窗
    const existingModal = document.getElementById('autoBindCardModal');
    if (existingModal) existingModal.remove();
    
    // 获取账号列表
    const result = await window.ipcRenderer.invoke('get-accounts');
    const accounts = result.success ? result.accounts : [];
    
    // 生成账号选项
    const accountOptions = accounts.map(acc => 
      `<option value="${acc.id}" data-email="${acc.email}">${acc.email}</option>`
    ).join('');
    
    const modalHTML = `
      <div id="autoBindCardModal" class="modal-overlay" style="display: flex;">
        <div class="modal-dialog" style="max-width: 600px; width: 95%; max-height: 90vh; overflow-y: auto; background: white; border-radius: 12px;" onclick="event.stopPropagation()">
          <div class="modern-modal-header">
            <div class="modal-title-row">
              <i data-lucide="credit-card" style="width: 24px; height: 24px; color: #34c759;"></i>
              <h3 class="modal-title">自动绑卡</h3>
            </div>
            <button class="modal-close-btn" onclick="AutoBindCard.closeModal()" title="关闭">
              <i data-lucide="x" style="width: 20px; height: 20px;"></i>
            </button>
          </div>
          
          <div class="modern-modal-body" style="padding: 20px;">
            <!-- 账号选择 -->
            <div class="form-group">
              <label style="font-weight: 600; margin-bottom: 8px; display: block;">选择账号</label>
              <select id="bindCardAccount" class="form-control" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #ddd;">
                <option value="">-- 请选择账号 --</option>
                ${accountOptions}
              </select>
            </div>
            
            <!-- 分隔线 -->
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            
            <!-- 账单信息 -->
            <div style="margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <label style="font-weight: 600;">账单信息</label>
                <button class="btn btn-secondary" style="padding: 4px 12px; font-size: 12px;" onclick="AutoBindCard.randomizeBilling()">
                  <i data-lucide="shuffle" style="width: 14px; height: 14px;"></i> 随机生成
                </button>
              </div>
              
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 12px; color: #666;">姓名</label>
                  <input type="text" id="bindCardName" class="form-control" placeholder="持卡人姓名" value="${this.config.billingName}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 12px; color: #666;">国家</label>
                  <select id="bindCardCountry" class="form-control">
                    <option value="CN" ${this.config.billingCountry === 'CN' ? 'selected' : ''}>中国 (CN)</option>
                    <option value="HK" ${this.config.billingCountry === 'HK' ? 'selected' : ''}>香港 (HK)</option>
                    <option value="US" ${this.config.billingCountry === 'US' ? 'selected' : ''}>美国 (US)</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 12px; color: #666;">省/州</label>
                  <input type="text" id="bindCardState" class="form-control" placeholder="省份或州" value="${this.config.billingState || ''}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 12px; color: #666;">城市</label>
                  <input type="text" id="bindCardCity" class="form-control" placeholder="城市" value="${this.config.billingCity}">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 12px; color: #666;">邮编</label>
                  <input type="text" id="bindCardPostalCode" class="form-control" placeholder="邮政编码" value="${this.config.billingPostalCode}">
                </div>
              </div>
              <div class="form-group" style="margin-top: 12px; margin-bottom: 0;">
                <label style="font-size: 12px; color: #666;">详细地址</label>
                <input type="text" id="bindCardAddress" class="form-control" placeholder="详细地址" value="${this.config.billingAddress}">
              </div>
            </div>
            
            <!-- 分隔线 -->
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            
            <!-- 虚拟卡配置 -->
            <div style="margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <label style="font-weight: 600;">虚拟卡信息</label>
                <div style="display: flex; gap: 8px;">
                  <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                    <input type="radio" name="cardMode" value="bin" ${this.config.cardMode === 'bin' ? 'checked' : ''} onchange="AutoBindCard.switchCardMode('bin')"> 卡号段生成
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                    <input type="radio" name="cardMode" value="full" ${this.config.cardMode === 'full' ? 'checked' : ''} onchange="AutoBindCard.switchCardMode('full')"> 完整卡信息
                  </label>
                </div>
              </div>
              
              <!-- 卡号段模式 -->
              <div id="cardBinMode" style="display: ${this.config.cardMode === 'bin' ? 'block' : 'none'};">
                <div class="form-group" style="margin-bottom: 0;">
                  <label style="font-size: 12px; color: #666;">卡号段 (x为随机数字)</label>
                  <input type="text" id="bindCardBin" class="form-control" placeholder="559888035xxxxxxx" value="${this.config.cardBin}">
                </div>
                <p style="font-size: 11px; color: #888; margin-top: 6px;">启动绑卡时将自动生成完整卡号、有效期和CVV</p>
              </div>
              
              <!-- 完整卡信息模式 -->
              <div id="cardFullMode" style="display: ${this.config.cardMode === 'full' ? 'block' : 'none'};">
                <div class="form-group" style="margin-bottom: 12px;">
                  <label style="font-size: 12px; color: #666;">卡号</label>
                  <input type="text" id="bindCardNumber" class="form-control" placeholder="16位卡号" value="${this.config.cardNumber}">
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 12px; color: #666;">有效月份</label>
                    <input type="text" id="bindCardExpMonth" class="form-control" placeholder="MM" maxlength="2" value="${this.config.cardExpMonth}">
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 12px; color: #666;">有效年份</label>
                    <input type="text" id="bindCardExpYear" class="form-control" placeholder="YY" maxlength="2" value="${this.config.cardExpYear}">
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 12px; color: #666;">CVV</label>
                    <input type="text" id="bindCardCvv" class="form-control" placeholder="CVV" maxlength="4" value="${this.config.cardCvv}">
                  </div>
                </div>
                <p style="font-size: 11px; color: #888; margin-top: 6px;">支持 13-19 位卡号，月份填 MM，年份填 YY 或 YYYY，CVV 填 3-4 位数字</p>
              </div>
            </div>
            
            <!-- 状态显示 -->
            <div id="bindCardStatus" style="display: none; padding: 12px; border-radius: 8px; margin-top: 16px; background: #f0f9ff; border: 1px solid #bae6fd;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <i data-lucide="loader-2" id="bindCardSpinner" style="width: 16px; height: 16px; animation: spin 1s linear infinite;"></i>
                <span id="bindCardStatusText">准备中...</span>
              </div>
            </div>
          </div>
          
          <div class="modern-modal-footer" style="padding: 16px 20px; border-top: 1px solid #eee; display: flex; gap: 12px; justify-content: flex-end;">
            <button class="btn btn-secondary" onclick="AutoBindCard.closeModal()">
              取消
            </button>
            <button class="btn btn-primary" id="startBindCardBtn" onclick="AutoBindCard.startBindCard()">
              <i data-lucide="play" style="width: 16px; height: 16px;"></i>
              开始绑卡
            </button>
          </div>
        </div>
      </div>
      <style>
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // 初始化图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    // 如果没有账单信息，自动生成
    if (!this.config.billingName) {
      this.randomizeBilling();
    }
    
    // ESC 关闭
    this._escHandler = (e) => {
      if (e.key === 'Escape') this.closeModal();
    };
    document.addEventListener('keydown', this._escHandler);
  },

  /**
   * 关闭弹窗
   */
  closeModal() {
    const modal = document.getElementById('autoBindCardModal');
    if (modal) modal.remove();
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
    }
  },

  /**
   * 切换卡片模式
   */
  switchCardMode(mode) {
    this.config.cardMode = mode;
    document.getElementById('cardBinMode').style.display = mode === 'bin' ? 'block' : 'none';
    document.getElementById('cardFullMode').style.display = mode === 'full' ? 'block' : 'none';
  },

  /**
   * 随机生成账单信息
   */
  randomizeBilling() {
    const name = this.generateRandomName();
    const address = this.generateRandomAddress();
    
    document.getElementById('bindCardName').value = name;
    document.getElementById('bindCardCountry').value = address.country;
    document.getElementById('bindCardState').value = address.province || '';
    document.getElementById('bindCardCity').value = address.city;
    document.getElementById('bindCardPostalCode').value = address.postalCode;
    document.getElementById('bindCardAddress').value = address.address;
    
    this.config.billingName = name;
    this.config.billingCountry = address.country;
    this.config.billingState = address.province || '';
    this.config.billingCity = address.city;
    this.config.billingPostalCode = address.postalCode;
    this.config.billingAddress = address.address;
  },

  /**
   * 更新状态显示
   */
  updateStatus(message, type = 'info') {
    const statusEl = document.getElementById('bindCardStatus');
    const textEl = document.getElementById('bindCardStatusText');
    const spinnerEl = document.getElementById('bindCardSpinner');
    
    if (!statusEl) return;
    
    statusEl.style.display = 'block';
    textEl.textContent = message;
    
    if (type === 'success') {
      statusEl.style.background = '#f0fdf4';
      statusEl.style.borderColor = '#86efac';
      spinnerEl.style.display = 'none';
    } else if (type === 'error') {
      statusEl.style.background = '#fef2f2';
      statusEl.style.borderColor = '#fecaca';
      spinnerEl.style.display = 'none';
    } else {
      statusEl.style.background = '#f0f9ff';
      statusEl.style.borderColor = '#bae6fd';
      spinnerEl.style.display = 'block';
    }
    
    // 刷新图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  },

  /**
   * 开始绑卡
   */
  async startBindCard() {
    // 获取选中的账号
    const accountSelect = document.getElementById('bindCardAccount');
    const selectedOption = accountSelect.options[accountSelect.selectedIndex];
    
    if (!selectedOption || !selectedOption.value) {
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('请先选择账号', 'warning');
      }
      return;
    }
    
    const accountId = selectedOption.value;
    
    // 保存配置
    this.config.billingName = document.getElementById('bindCardName').value;
    this.config.billingCountry = document.getElementById('bindCardCountry').value;
    this.config.billingState = document.getElementById('bindCardState').value;
    this.config.billingCity = document.getElementById('bindCardCity').value;
    this.config.billingPostalCode = document.getElementById('bindCardPostalCode').value;
    this.config.billingAddress = document.getElementById('bindCardAddress').value;
    
    if (this.config.cardMode === 'bin') {
      this.config.cardBin = document.getElementById('bindCardBin').value;
    } else {
      const validationResult = this.validateFullCardInfo({
        cardNumber: document.getElementById('bindCardNumber').value,
        month: document.getElementById('bindCardExpMonth').value,
        year: document.getElementById('bindCardExpYear').value,
        cvv: document.getElementById('bindCardCvv').value
      });

      if (!validationResult.success) {
        return;
      }

      this.config.cardNumber = validationResult.cardInfo.cardNumber;
      this.config.cardExpMonth = validationResult.cardInfo.month;
      this.config.cardExpYear = validationResult.cardInfo.year;
      this.config.cardCvv = validationResult.cardInfo.cvv;

      document.getElementById('bindCardNumber').value = this.config.cardNumber;
      document.getElementById('bindCardExpMonth').value = this.config.cardExpMonth;
      document.getElementById('bindCardExpYear').value = this.config.cardExpYear;
      document.getElementById('bindCardCvv').value = this.config.cardCvv;
    }
    
    this.saveConfig();
    
    // 验证必填项
    if (!this.config.billingName) {
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('请填写持卡人姓名', 'warning');
      }
      return;
    }
    
    // 禁用按钮
    const btn = document.getElementById('startBindCardBtn');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" style="width: 16px; height: 16px; animation: spin 1s linear infinite;"></i> 处理中...';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    try {
      // 1. 获取支付链接
      this.updateStatus('正在获取支付链接...');
      
      const linkResult = await window.ipcRenderer.invoke('get-payment-link', { accountId });
      
      if (!linkResult.success || !linkResult.paymentLink) {
        this.updateStatus(linkResult.error || '获取支付链接失败', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play" style="width: 16px; height: 16px;"></i> 开始绑卡';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }
      
      // 2. 准备卡片信息
      let cardInfo;
      if (this.config.cardMode === 'bin') {
        cardInfo = this.generateCardInfo();
      } else {
        cardInfo = {
          cardNumber: this.config.cardNumber,
          month: this.config.cardExpMonth,
          year: this.config.cardExpYear,
          cvv: this.config.cardCvv
        };
      }
      
      // 3. 构建绑卡信息并打开浏览器
      const bindCardData = {
        paymentLink: linkResult.paymentLink,
        billing: {
          name: this.config.billingName,
          country: this.config.billingCountry,
          state: this.config.billingState,
          city: this.config.billingCity,
          address: this.config.billingAddress,
          postalCode: this.config.billingPostalCode
        },
        card: cardInfo
      };
      
      this.updateStatus('正在打开浏览器...');
      
      await window.ipcRenderer.invoke('open-external-url', linkResult.paymentLink);
      
      this.updateStatus('浏览器已打开，请在浏览器中完成支付', 'success');
      
      this.showCardInfoModal(cardInfo, this.config);
      
    } catch (error) {
      this.updateStatus('绑卡失败: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="play" style="width: 16px; height: 16px;"></i> 开始绑卡';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },

  /**
   * 显示卡片信息弹窗（供用户复制填写）
   */
  showCardInfoModal(cardInfo, config) {
    const existingModal = document.getElementById('cardInfoDisplayModal');
    if (existingModal) existingModal.remove();
    
    const modalHTML = `
      <div id="cardInfoDisplayModal" class="modal-overlay" style="display: flex; z-index: 10001;">
        <div class="modal-dialog modern-modal" style="max-width: 450px; width: 90%;" onclick="event.stopPropagation()">
          <div class="modern-modal-header">
            <div class="modal-title-row">
              <i data-lucide="clipboard-list" style="width: 24px; height: 24px; color: #007aff;"></i>
              <h3 class="modal-title">填写信息</h3>
            </div>
            <button class="modal-close-btn" onclick="document.getElementById('cardInfoDisplayModal').remove()" title="关闭">
              <i data-lucide="x" style="width: 20px; height: 20px;"></i>
            </button>
          </div>
          
          <div class="modern-modal-body" style="padding: 20px;">
            <p style="color: #666; margin-bottom: 16px; font-size: 13px;">请在浏览器支付页面中填写以下信息：</p>
            
            <!-- 卡片信息 -->
            <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <div style="font-weight: 600; margin-bottom: 12px; color: #1e293b;">卡片信息</div>
              <div style="display: grid; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">卡号</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${cardInfo.cardNumber}</code>
                    <button onclick="AutoBindCard.copyText('${cardInfo.cardNumber}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">有效期</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${cardInfo.month}/${cardInfo.year}</code>
                    <button onclick="AutoBindCard.copyText('${cardInfo.month}/${cardInfo.year}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">CVV</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${cardInfo.cvv}</code>
                    <button onclick="AutoBindCard.copyText('${cardInfo.cvv}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 账单信息 -->
            <div style="background: #f8fafc; border-radius: 8px; padding: 16px;">
              <div style="font-weight: 600; margin-bottom: 12px; color: #1e293b;">账单信息</div>
              <div style="display: grid; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">姓名</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingName}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingName}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">国家</span>
                  <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingCountry}</code>
                </div>
                ${config.billingState ? `<div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">省/州</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingState}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingState}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>` : ''}
                ${config.billingCity ? `<div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">城市/地区</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingCity}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingCity}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>` : ''}
                ${config.billingDistrict ? `<div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">地区</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingDistrict}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingDistrict}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>` : ''}
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">地址</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${config.billingAddress}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingAddress}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>
                ${config.billingAddress2 ? `<div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">地址第2行</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingAddress2}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingAddress2}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>` : ''}
                ${config.billingPostalCode ? `<div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #64748b; font-size: 13px;">邮编</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <code style="background: white; padding: 4px 8px; border-radius: 4px;">${config.billingPostalCode}</code>
                    <button onclick="AutoBindCard.copyText('${config.billingPostalCode}')" style="background: none; border: none; cursor: pointer; padding: 4px;">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: #007aff;"></i>
                    </button>
                  </div>
                </div>` : ''}
              </div>
            </div>
          </div>
          
          <div class="modern-modal-footer">
            <button class="btn btn-primary" onclick="document.getElementById('cardInfoDisplayModal').remove()">
              完成
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  },

  /**
   * 复制文本到剪贴板
   */
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('已复制', 'success', 1500);
      }
    } catch (e) {
      console.error('复制失败:', e);
    }
  },

  /**
   * 刷新账号列表（页面视图）
   * 只显示 free 账号或账号类型为空的账号
   */
  async refreshAccountList() {
    const select = document.getElementById('autoBindAccountSelect');
    if (!select) return;
    
    const result = await window.ipcRenderer.invoke('get-accounts');
    const allAccounts = result.success ? result.accounts : [];
    
    // 只保留 free 账号或账号类型为空的账号（字段名是 type）
    const accounts = allAccounts.filter(acc => {
      const accountType = (acc.type || '').toLowerCase().trim();
      return !accountType || accountType === 'free';
    });
    
    select.innerHTML = '<option value="">-- 请选择账号 --</option>';
    accounts.forEach(acc => {
      const option = document.createElement('option');
      option.value = acc.id;
      option.setAttribute('data-email', acc.email);
      const typeLabel = acc.type ? ` (${acc.type})` : ' (未知)';
      option.textContent = acc.email + typeLabel;
      select.appendChild(option);
    });
    
    if (typeof showCenterMessage === 'function') {
      showCenterMessage(`已加载 ${accounts.length} 个可绑卡账号（共 ${allAccounts.length} 个）`, 'success');
    }
  },

  /**
   * 切换卡片模式（页面视图）
   */
  switchCardModeView(mode) {
    document.getElementById('autoBindBinMode').style.display = mode === 'bin' ? 'block' : 'none';
    document.getElementById('autoBindFullMode').style.display = mode === 'full' ? 'block' : 'none';
    this.config.cardMode = mode;
  },

  /**
   * 解析粘贴的卡片信息
   * 支持格式: 卡号|月份|年份|CVV (如: 5598880380486821|06|2030|331)
   */
  parseCardInfo() {
    const pasteInput = document.getElementById('autoBindCardPaste');
    if (!pasteInput || !pasteInput.value.trim()) {
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('请先粘贴卡片信息', 'warning');
      }
      return;
    }
    
    const rawValue = pasteInput.value.trim();
    // 支持 | 或 / 或空格分隔
    const parts = rawValue.split(/[|\/\s]+/);
    
    if (parts.length < 4) {
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('格式错误，请使用: 卡号|月份|年份|CVV', 'error');
      }
      return;
    }
    
    const validationResult = this.validateFullCardInfo({
      cardNumber: parts[0],
      month: parts[1],
      year: parts[2],
      cvv: parts[3]
    });

    if (!validationResult.success) {
      return;
    }
    
    const { cardNumber, month, year, cvv } = validationResult.cardInfo;
    
    // 填充到输入框
    document.getElementById('autoBindCardNumber').value = cardNumber;
    document.getElementById('autoBindExpMonth').value = month;
    document.getElementById('autoBindExpYear').value = year;
    document.getElementById('autoBindCvv').value = cvv;
    
    // 清空粘贴框
    pasteInput.value = '';
    
    if (typeof showCenterMessage === 'function') {
      showCenterMessage('卡片信息解析成功', 'success');
    }
  },

  /**
   * 切换国家时更新表单字段（固定布局，不隐藏字段）
   */
  switchCountry(countryCode) {
    this.config.billingCountry = countryCode;
    const countryInfo = this.countryData[countryCode] || this.countryData['CN'];
    
    // 更新省份下拉框选项
    const provinceSelect = document.getElementById('autoBindProvince');
    if (provinceSelect) {
      const placeholderText = countryInfo.provinceLabel || '省/州';
      provinceSelect.innerHTML = `<option value="">${placeholderText}</option>`;
      if (countryInfo.provinces) {
        countryInfo.provinces.forEach(p => {
          const displayName = countryInfo.provinceNames ? (countryInfo.provinceNames[p] || p) : p;
          provinceSelect.innerHTML += `<option value="${p}">${displayName}</option>`;
        });
      }
    }
    
    // 更新城市 placeholder
    const cityInput = document.getElementById('autoBindCity');
    if (cityInput) cityInput.placeholder = countryInfo.cityLabel || '城市';
    
    // 更新地区 placeholder
    const districtInput = document.getElementById('autoBindDistrict');
    if (districtInput) districtInput.placeholder = countryInfo.districtLabel || '区/县';
    
    // 清空当前值
    if (provinceSelect) provinceSelect.value = '';
    if (cityInput) cityInput.value = '';
    if (districtInput) districtInput.value = '';
    const postalCodeInput = document.getElementById('autoBindPostalCode');
    if (postalCodeInput) postalCodeInput.value = '';
  },

  /**
   * 切换填写模式
   */
  switchFillMode(mode) {
    this.config.fillMode = mode;
    
    const manualLabel = document.getElementById('manualModeLabel');
    const autoLabel = document.getElementById('autoModeLabel');
    const descEl = document.getElementById('fillModeDesc');
    
    if (manualLabel && autoLabel) {
      if (mode === 'manual') {
        manualLabel.style.borderColor = '#007aff';
        manualLabel.style.background = '#f0f7ff';
        autoLabel.style.borderColor = '#ddd';
        autoLabel.style.background = 'transparent';
      } else {
        autoLabel.style.borderColor = '#34c759';
        autoLabel.style.background = '#f0fdf4';
        manualLabel.style.borderColor = '#ddd';
        manualLabel.style.background = 'transparent';
      }
    }
    
    if (descEl) {
      if (mode === 'manual') {
        descEl.innerHTML = '<i data-lucide="info" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>手动模式：打开浏览器后显示卡片信息，您需要手动复制填写';
      } else {
        descEl.innerHTML = '<i data-lucide="info" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>自动模式：自动打开浏览器并填写卡片信息（需要安装 Chrome 浏览器）';
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },

  /**
   * 随机生成账单信息（页面视图）
   */
  randomizeBillingView() {
    // 获取当前选择的国家
    const currentCountry = document.getElementById('autoBindCountry')?.value || 'CN';
    const name = this.generateRandomName(currentCountry);
    const address = this.generateRandomAddress(currentCountry);
    
    document.getElementById('autoBindName').value = name;
    // 确保省份下拉框已填充选项
    this.switchCountry(currentCountry);
    // 设置省份值
    if (document.getElementById('autoBindProvince')) {
      document.getElementById('autoBindProvince').value = address.province;
    }
    if (document.getElementById('autoBindCity')) {
      document.getElementById('autoBindCity').value = address.city;
    }
    if (document.getElementById('autoBindDistrict')) {
      document.getElementById('autoBindDistrict').value = address.district || '';
    }
    if (document.getElementById('autoBindPostalCode')) {
      document.getElementById('autoBindPostalCode').value = address.postalCode || '';
    }
    if (document.getElementById('autoBindAddress')) {
      document.getElementById('autoBindAddress').value = address.address;
    }
    if (document.getElementById('autoBindAddress2')) {
      document.getElementById('autoBindAddress2').value = address.address2 || '';
    }
    
    if (typeof showCenterMessage === 'function') {
      showCenterMessage('已生成随机账单信息', 'success');
    }
  },

  /**
   * 保存页面视图配置
   */
  saveViewConfig() {
    this.config.billingName = document.getElementById('autoBindName')?.value || '';
    this.config.billingCountry = document.getElementById('autoBindCountry')?.value || 'CN';
    this.config.billingState = document.getElementById('autoBindProvince')?.value || '';
    this.config.billingCity = document.getElementById('autoBindCity')?.value || '';
    this.config.billingDistrict = document.getElementById('autoBindDistrict')?.value || '';
    this.config.billingPostalCode = document.getElementById('autoBindPostalCode')?.value || '';
    this.config.billingAddress = document.getElementById('autoBindAddress')?.value || '';
    this.config.billingAddress2 = document.getElementById('autoBindAddress2')?.value || '';
    this.config.cardBin = document.getElementById('autoBindCardBin')?.value || '559888035xxxxxxx';
    this.config.cardNumber = document.getElementById('autoBindCardNumber')?.value || '';
    this.config.cardExpMonth = document.getElementById('autoBindExpMonth')?.value || '';
    this.config.cardExpYear = document.getElementById('autoBindExpYear')?.value || '';
    this.config.cardCvv = document.getElementById('autoBindCvv')?.value || '';
    
    this.saveConfig();
    
    if (typeof showCenterMessage === 'function') {
      showCenterMessage('配置已保存', 'success');
    }
  },

  /**
   * 加载配置到页面视图
   */
  loadViewConfig() {
    const nameEl = document.getElementById('autoBindName');
    const countryEl = document.getElementById('autoBindCountry');
    const provinceEl = document.getElementById('autoBindProvince');
    const cityEl = document.getElementById('autoBindCity');
    const districtEl = document.getElementById('autoBindDistrict');
    const postalCodeEl = document.getElementById('autoBindPostalCode');
    const addressEl = document.getElementById('autoBindAddress');
    const address2El = document.getElementById('autoBindAddress2');
    const cardBinEl = document.getElementById('autoBindCardBin');
    
    if (nameEl) nameEl.value = this.config.billingName || '';
    
    // 先设置国家，再初始化省份下拉框
    const country = this.config.billingCountry || 'CN';
    if (countryEl) countryEl.value = country;
    // 初始化省份下拉框选项
    this.switchCountry(country);
    
    // 然后设置省份值
    if (provinceEl) provinceEl.value = this.config.billingState || '';
    if (cityEl) cityEl.value = this.config.billingCity || '';
    if (districtEl) districtEl.value = this.config.billingDistrict || '';
    if (postalCodeEl) postalCodeEl.value = this.config.billingPostalCode || '';
    if (addressEl) addressEl.value = this.config.billingAddress || '';
    if (address2El) address2El.value = this.config.billingAddress2 || '';
    if (cardBinEl) cardBinEl.value = this.config.cardBin || '559888035xxxxxxx';
    
    // 如果没有账单信息，自动生成
    if (!this.config.billingName && nameEl) {
      this.randomizeBillingView();
    }
  },

  /**
   * 更新状态显示（页面视图）
   */
  updateStatusView(message, type = 'info') {
    const statusEl = document.getElementById('autoBindStatus');
    const textEl = document.getElementById('autoBindStatusText');
    const spinnerEl = document.getElementById('autoBindSpinner');
    
    if (!statusEl) return;
    
    statusEl.style.display = 'block';
    textEl.textContent = message;
    
    if (type === 'success') {
      statusEl.style.background = '#f0fdf4';
      spinnerEl.style.display = 'none';
    } else if (type === 'error') {
      statusEl.style.background = '#fef2f2';
      spinnerEl.style.display = 'none';
    } else {
      statusEl.style.background = '#f0f9ff';
      spinnerEl.style.display = 'block';
    }
    
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  },

  /**
   * 从页面视图开始绑卡
   */
  async startFromView() {
    // 检查每日使用限制
    if (this.isLimitExceeded()) {
      this.showLimitModal();
      return;
    }
    
    // 获取选中的账号
    const accountSelect = document.getElementById('autoBindAccountSelect');
    const selectedOption = accountSelect?.options[accountSelect.selectedIndex];
    
    if (!selectedOption || !selectedOption.value) {
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('请先选择账号', 'warning');
      }
      return;
    }
    
    const accountId = selectedOption.value;
    
    // 增加使用次数并更新显示
    await this.incrementUsage();
    this.updateUsageDisplay();
    
    // 保存配置
    this.saveViewConfig();

    if (this.config.cardMode === 'full') {
      const validationResult = this.validateFullCardInfo({
        cardNumber: this.config.cardNumber,
        month: this.config.cardExpMonth,
        year: this.config.cardExpYear,
        cvv: this.config.cardCvv
      });

      if (!validationResult.success) {
        return;
      }

      this.config.cardNumber = validationResult.cardInfo.cardNumber;
      this.config.cardExpMonth = validationResult.cardInfo.month;
      this.config.cardExpYear = validationResult.cardInfo.year;
      this.config.cardCvv = validationResult.cardInfo.cvv;

      const cardNumberInput = document.getElementById('autoBindCardNumber');
      const expMonthInput = document.getElementById('autoBindExpMonth');
      const expYearInput = document.getElementById('autoBindExpYear');
      const cvvInput = document.getElementById('autoBindCvv');

      if (cardNumberInput) cardNumberInput.value = this.config.cardNumber;
      if (expMonthInput) expMonthInput.value = this.config.cardExpMonth;
      if (expYearInput) expYearInput.value = this.config.cardExpYear;
      if (cvvInput) cvvInput.value = this.config.cardCvv;
    }
    
    // 验证必填项
    if (!this.config.billingName) {
      if (typeof showCenterMessage === 'function') {
        showCenterMessage('请填写持卡人姓名', 'warning');
      }
      return;
    }
    
    // 禁用按钮
    const btn = document.getElementById('startAutoBindBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" style="width: 16px; height: 16px; animation: spin 1s linear infinite;"></i> 处理中...';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    
    try {
      // 1. 获取支付链接
      this.updateStatusView('正在获取支付链接...');
      
      const linkResult = await window.ipcRenderer.invoke('get-payment-link', { accountId });
      
      if (!linkResult.success || !linkResult.paymentLink) {
        this.updateStatusView(linkResult.error || '获取支付链接失败', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="play" style="width: 16px; height: 16px;"></i> 开始绑卡';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
        return;
      }
      
      // 2. 准备卡片信息
      let cardInfo;
      if (this.config.cardMode === 'bin') {
        cardInfo = this.generateCardInfo();
      } else {
        cardInfo = {
          cardNumber: this.config.cardNumber,
          month: this.config.cardExpMonth,
          year: this.config.cardExpYear,
          cvv: this.config.cardCvv
        };
      }
      
      // 3. 根据填写模式处理
      if (this.config.fillMode === 'auto') {
        // 自动填写模式 - 显示日志弹窗
        this.showAutoFillLogModal();
        this.updateStatusView('正在启动浏览器并自动填写...');
        
        const autoFillResult = await window.ipcRenderer.invoke('auto-fill-payment', {
          paymentLink: linkResult.paymentLink,
          card: cardInfo,
          billing: {
            name: this.config.billingName,
            country: this.config.billingCountry,
            state: this.config.billingState,
            city: this.config.billingCity,
            district: this.config.billingDistrict,
            address: this.config.billingAddress,
            address2: this.config.billingAddress2,
            postalCode: this.config.billingPostalCode
          }
        });
        
        if (autoFillResult.success) {
          this.updateStatusView('自动填写完成，请在浏览器中确认并点击订阅按钮', 'success');
          this.addAutoFillLog('✓ 自动填写完成', 'success');
        } else {
          this.updateStatusView('自动填写失败: ' + autoFillResult.error, 'error');
          this.addAutoFillLog('✗ ' + autoFillResult.error, 'error');
          // 失败时显示卡片信息供手动填写
          this.showCardInfoModal(cardInfo, this.config);
        }
      } else {
        // 手动填写模式
        this.updateStatusView('正在打开浏览器...');
        
        await window.ipcRenderer.invoke('open-external-url', linkResult.paymentLink);
        
        this.updateStatusView('浏览器已打开，请在浏览器中完成支付', 'success');
        
        // 显示卡片信息弹窗
        this.showCardInfoModal(cardInfo, this.config);
      }
      
    } catch (error) {
      this.updateStatusView('绑卡失败: ' + error.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play" style="width: 16px; height: 16px;"></i> 开始绑卡';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  },

  /**
   * 更新使用次数显示
   */
  updateUsageDisplay() {
    const usageEl = document.getElementById('autoBindUsageCount');
    if (usageEl) {
      usageEl.textContent = this.getTodayUsage();
    }
  },

  /**
   * 页面切换时初始化
   */
  async onViewSwitch() {
    // 先从配置文件加载使用次数
    await this.loadUsageFromConfig();
    
    // 更新使用次数显示
    this.updateUsageDisplay();
    
    // 检查每日使用限制
    if (this.isLimitExceeded()) {
      this.showLimitModal();
      return;
    }
    
    // 先从配置文件加载
    await this.loadConfig();
    // 再加载到视图
    this.loadViewConfig();
    this.refreshAccountList();
    
    // 监听自动填写日志
    if (window.ipcRenderer) {
      window.ipcRenderer.on('auto-fill-log', (event, message) => {
        this.addAutoFillLog(message);
      });
    }
  },

  /**
   * 显示自动填写日志弹窗
   */
  showAutoFillLogModal() {
    // 移除已存在的弹窗
    const existing = document.getElementById('autoFillLogModal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'autoFillLogModal';
    modal.className = 'modal-overlay active';
    modal.style.zIndex = '10002';
    modal.innerHTML = `
      <div class="modal-dialog modern-modal" style="max-width: 450px;" onclick="event.stopPropagation()">
        <div class="modern-modal-header" style="padding: 14px 16px;">
          <div class="modal-title-row">
            <i data-lucide="terminal" style="width: 16px; height: 16px; color: #007aff;"></i>
            <h3 style="margin: 0; font-size: 14px; font-weight: 600;">自动填写日志</h3>
          </div>
          <button class="modal-close-btn" onclick="document.getElementById('autoFillLogModal').remove()" style="width: 24px; height: 24px;">
            <i data-lucide="x" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
        <div class="modern-modal-body" style="padding: 12px;">
          <div id="autoFillLogContent" style="max-height: 300px; overflow-y: auto; background: #18181b; border-radius: 6px; padding: 10px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px; color: #a1a1aa; line-height: 1.6;">
            <div style="color: #86868b;">正在启动...</div>
          </div>
        </div>
        <div class="modern-modal-footer" style="padding: 12px 16px;">
          <button class="btn btn-secondary" onclick="document.getElementById('autoFillLogModal').remove()" style="font-size: 12px; padding: 6px 16px;">关闭</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  /**
   * 添加自动填写日志
   */
  addAutoFillLog(message, type = 'info') {
    const container = document.getElementById('autoFillLogContent');
    if (!container) return;
    
    const colors = {
      info: '#a1a1aa',
      success: '#22c55e',
      error: '#ef4444',
      warning: '#f59e0b'
    };
    
    const div = document.createElement('div');
    div.style.color = colors[type] || colors.info;
    div.textContent = message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
};

// 全局函数
function openAutoBindCardModal() {
  AutoBindCard.openModal();
}

// 初始化
if (typeof window !== 'undefined') {
  window.AutoBindCard = AutoBindCard;
  AutoBindCard.init();
}
