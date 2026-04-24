#!/bin/bash

# Windows 打包脚本
# 用于在 macOS 上交叉编译 Windows 版本

echo "========================================"
echo "Windsurf-Tool Windows 打包工具"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo "请先安装 Node.js: https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js 版本: $(node --version)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm"
    exit 1
fi

echo "✓ npm 版本: $(npm --version)"
echo ""

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

echo "✓ 依赖已安装"
echo ""

# 清理旧的打包文件
echo "🧹 清理旧的打包文件..."
rm -rf dist/*.exe
rm -rf dist/*.nsis.*
rm -rf dist/win-unpacked
echo "✓ 清理完成"
echo ""

# 开始打包
echo "========================================"
echo "开始打包 Windows 版本..."
echo "========================================"
echo ""
echo "⚠️  注意事项:"
echo "1. 在 macOS 上交叉编译 Windows 版本"
echo "2. robotjs 需要在 Windows 上重新编译"
echo "3. 建议在 Windows 系统上进行最终打包"
echo ""
echo "打包目标:"
echo "  - NSIS 安装程序 (x64, arm64)"
echo "  - 便携版 EXE (x64, arm64)"
echo ""

read -p "按 Enter 继续，或 Ctrl+C 取消..."

# 执行打包
npm run build:win

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "✅ 打包完成!"
    echo "========================================"
    echo ""
    echo "输出文件位置: ./dist/"
    echo ""
    
    # 列出生成的文件
    if [ -d "dist" ]; then
        echo "生成的文件:"
        ls -lh dist/*.exe 2>/dev/null || echo "  (未找到 .exe 文件)"
        ls -lh dist/*.nsis.* 2>/dev/null || echo "  (未找到 NSIS 安装程序)"
        echo ""
    fi
    
    echo "📝 重要提示:"
    echo "1. robotjs 可能需要在 Windows 上重新编译"
    echo "2. 建议在 Windows 系统上测试打包后的应用"
    echo "3. 如遇到问题，请在 Windows 上运行: npm run build:win"
    echo ""
    echo "Windows 打包命令:"
    echo "  npm install                    # 安装依赖"
    echo "  npm install --global windows-build-tools  # 安装构建工具"
    echo "  npm run build:win              # 打包"
    echo ""
else
    echo ""
    echo "========================================"
    echo "❌ 打包失败"
    echo "========================================"
    echo ""
    echo "可能的原因:"
    echo "1. electron-builder 配置错误"
    echo "2. 缺少必要的依赖"
    echo "3. robotjs 编译失败"
    echo ""
    echo "建议:"
    echo "1. 在 Windows 系统上进行打包"
    echo "2. 查看上面的错误信息"
    echo "3. 运行: npm install --force"
    echo ""
    exit 1
fi
