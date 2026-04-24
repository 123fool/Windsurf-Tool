/**
 * 打包前准备脚本
 * 备份原始 main.js，创建字节码加载入口
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'main.js');
const backupPath = path.join(__dirname, '..', 'main.original.js');

// 备份原始 main.js
if (fs.existsSync(mainPath)) {
  console.log('📦 备份原始 main.js...');
  fs.copyFileSync(mainPath, backupPath);
}

// 创建字节码加载入口
const loaderContent = `"use strict";
// 生产环境入口 - 加载 V8 字节码
require("./dist/main/bytecode-loader.cjs");
require("./dist/main/index.jsc");
`;

fs.writeFileSync(mainPath, loaderContent, 'utf8');
console.log('✅ 已创建字节码加载入口');

// 注册退出时恢复
process.on('exit', () => {
  // electron-builder 会在这之后运行，所以不能在这里恢复
});

console.log('⚠️  注意: 打包完成后请运行 npm run restore-main 恢复原始 main.js');
