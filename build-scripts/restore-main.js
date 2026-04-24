/**
 * 恢复原始 main.js
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'main.js');
const backupPath = path.join(__dirname, '..', 'main.original.js');

if (fs.existsSync(backupPath)) {
  console.log('📦 恢复原始 main.js...');
  fs.copyFileSync(backupPath, mainPath);
  fs.unlinkSync(backupPath);
  console.log('✅ 已恢复原始 main.js');
} else {
  console.log('⚠️  未找到备份文件 main.original.js');
}
