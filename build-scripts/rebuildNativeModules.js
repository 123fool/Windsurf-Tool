#!/usr/bin/env node
/**
 * Windows native模块重建脚本
 * 用于在打包前重建robotjs等native模块
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isWindows = process.platform === 'win32';

if (!isWindows) {
  console.log('✓ 非Windows系统，跳过native模块重建');
  process.exit(0);
}

console.log('🔧 开始重建Windows native模块...');

try {
  // 检查robotjs是否存在
  const robotjsPath = path.join(__dirname, '..', 'node_modules', 'robotjs');
  
  if (!fs.existsSync(robotjsPath)) {
    console.log('⚠️  robotjs不存在，跳过重建');
    process.exit(0);
  }

  console.log('📦 重建robotjs...');
  
  try {
    // 尝试使用npm rebuild
    execSync('npm rebuild robotjs --build-from-source', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log('✓ robotjs重建成功');
  } catch (error) {
    console.warn('⚠️  robotjs重建失败，但继续打包（robotjs为可选依赖）');
    // 不中断打包流程
  }

  console.log('✓ native模块重建完成');
  process.exit(0);
  
} catch (error) {
  console.error('❌ native模块重建出错:', error.message);
  // 不中断打包流程
  process.exit(0);
}
