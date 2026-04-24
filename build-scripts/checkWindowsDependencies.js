#!/usr/bin/env node
/**
 * Windows依赖检查脚本
 * 检查Windows打包所需的所有依赖
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isWindows = process.platform === 'win32';

if (!isWindows) {
  console.log('✓ 非Windows系统，跳过Windows依赖检查');
  process.exit(0);
}

console.log('🔍 检查Windows打包依赖...\n');

const checks = [
  {
    name: 'Node.js',
    check: () => {
      try {
        const version = execSync('node --version', { encoding: 'utf-8' }).trim();
        console.log(`✓ Node.js: ${version}`);
        return true;
      } catch {
        console.error('✗ Node.js: 未安装');
        return false;
      }
    }
  },
  {
    name: 'npm',
    check: () => {
      try {
        const version = execSync('npm --version', { encoding: 'utf-8' }).trim();
        console.log(`✓ npm: ${version}`);
        return true;
      } catch {
        console.error('✗ npm: 未安装');
        return false;
      }
    }
  },
  {
    name: 'Python 3',
    check: () => {
      try {
        const version = execSync('python --version', { encoding: 'utf-8' }).trim();
        console.log(`✓ Python: ${version}`);
        return true;
      } catch {
        try {
          const version = execSync('python3 --version', { encoding: 'utf-8' }).trim();
          console.log(`✓ Python: ${version}`);
          return true;
        } catch {
          console.warn('⚠ Python 3: 未安装（可选，用于浏览器自动登录）');
          return true;
        }
      }
    }
  },
  {
    name: 'chrome-launcher',
    check: () => {
      const modulePath = path.join(__dirname, '..', 'node_modules', 'chrome-launcher');
      if (fs.existsSync(modulePath)) {
        console.log('✓ chrome-launcher: 已安装');
        return true;
      } else {
        console.error('✗ chrome-launcher: 未安装');
        return false;
      }
    }
  },
  {
    name: 'puppeteer',
    check: () => {
      const modulePath = path.join(__dirname, '..', 'node_modules', 'puppeteer');
      if (fs.existsSync(modulePath)) {
        console.log('✓ puppeteer: 已安装');
        return true;
      } else {
        console.error('✗ puppeteer: 未安装');
        return false;
      }
    }
  },
  {
    name: 'puppeteer-real-browser',
    check: () => {
      const modulePath = path.join(__dirname, '..', 'node_modules', 'puppeteer-real-browser');
      if (fs.existsSync(modulePath)) {
        console.log('✓ puppeteer-real-browser: 已安装');
        return true;
      } else {
        console.error('✗ puppeteer-real-browser: 未安装');
        return false;
      }
    }
  },
  {
    name: 'icon.ico',
    check: () => {
      const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
      if (fs.existsSync(iconPath)) {
        console.log('✓ icon.ico: 已生成');
        return true;
      } else {
        console.error('✗ icon.ico: 未生成');
        return false;
      }
    }
  }
];

let allPassed = true;
checks.forEach(check => {
  try {
    if (!check.check()) {
      allPassed = false;
    }
  } catch (error) {
    console.error(`✗ ${check.name}: 检查失败 - ${error.message}`);
    allPassed = false;
  }
});

console.log('\n' + '='.repeat(50));

if (allPassed) {
  console.log('✅ 所有必需依赖已安装，可以开始打包');
  process.exit(0);
} else {
  console.log('❌ 某些依赖缺失，请先安装');
  console.log('\n建议命令:');
  console.log('  npm install');
  process.exit(1);
}
