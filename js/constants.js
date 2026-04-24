const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_WORKER_URL = 'https://windsurf.hfhddfj.cn';

function normalizeRuntimeConfig(rawConfig) {
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

  return mergedConfig;
}

function getUserDataPath() {
  if (process.env.WINDSURF_TOOL_USER_DATA_PATH) {
    return process.env.WINDSURF_TOOL_USER_DATA_PATH;
  }

  const homeDir = os.homedir();

  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'windsurf-tool');
  }
  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'windsurf-tool');
  }

  return path.join(homeDir, '.config', 'windsurf-tool');
}

function readRuntimeConfig() {
  try {
    const configPath = path.join(getUserDataPath(), 'windsurf-app-config.json');
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const fileText = fs.readFileSync(configPath, 'utf-8');
    return normalizeRuntimeConfig(JSON.parse(fileText));
  } catch (error) {
    return {};
  }
}

function getConfiguredWorkerUrl() {
  const envWorkerUrl = process.env.WINDSURF_WORKER_URL;
  if (envWorkerUrl && /^https?:\/\//i.test(envWorkerUrl)) {
    return envWorkerUrl.trim().replace(/\/+$/, '');
  }

  const config = readRuntimeConfig();
  if (config.workerUrl && /^https?:\/\//i.test(config.workerUrl)) {
    return String(config.workerUrl).trim().replace(/\/+$/, '');
  }

  return DEFAULT_WORKER_URL;
}

/**
 * 全局常量配置
 */
const CONSTANTS = {
  get WORKER_URL() {
    return getConfiguredWorkerUrl();
  },
  DEFAULT_WORKER_URL,

  // Cloudflare Worker 访问密钥（用于验证请求来源，防止滥用）
  // 必须与 Cloudflare Workers 中的 SECRET_KEY 一致
  WORKER_SECRET_KEY: 'djisoaksBHIKSOI87126221',
  
  // Firebase API Key
  FIREBASE_API_KEY: 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY',
  
  // Windsurf 注册 API
  WINDSURF_REGISTER_API: 'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
  
  // 请求超时时间 (ms)
  REQUEST_TIMEOUT: 30000,

  getWorkerUrl() {
    return getConfiguredWorkerUrl();
  }
};

module.exports = CONSTANTS;
