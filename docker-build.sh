#!/bin/bash

# Docker Windows 打包脚本
echo "========================================"
echo "🐳 Docker Windows 打包工具"
echo "========================================"
echo ""

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未找到 Docker"
    echo "请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

echo "✓ Docker 版本: $(docker --version)"
echo ""

# 检查Docker是否运行
if ! docker info &> /dev/null; then
    echo "❌ 错误: Docker 未运行"
    echo "请启动 Docker Desktop"
    exit 1
fi

echo "✓ Docker 服务正在运行"
echo ""

# 拉取基础镜像
echo "📥 拉取 Docker 基础镜像..."
docker pull electronuserland/builder:wine

if [ $? -ne 0 ]; then
    echo "❌ 基础镜像拉取失败"
    exit 1
fi

echo "✓ 基础镜像拉取完成"
echo ""

# 构建Docker镜像
echo "🔨 构建 Docker 镜像..."
docker build -f Dockerfile.windows -t windsurf-builder .

if [ $? -ne 0 ]; then
    echo "❌ Docker 镜像构建失败"
    exit 1
fi

echo "✓ Docker 镜像构建完成"
echo ""

# 创建输出目录
mkdir -p dist

# 运行打包
echo "📦 开始 Windows 打包..."
docker run --rm \
    -v "$(pwd)/dist:/project/dist" \
    -v "$(pwd)/node_modules:/project/node_modules" \
    windsurf-builder

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "✅ Docker 打包完成!"
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
    
    echo "📝 使用说明:"
    echo "1. 生成的文件在 ./dist/ 目录中"
    echo "2. .exe 文件是便携版应用"
    echo "3. .nsis.exe 文件是安装程序"
    echo ""
else
    echo ""
    echo "========================================"
    echo "❌ Docker 打包失败"
    echo "========================================"
    echo ""
    echo "可能的原因:"
    echo "1. Docker 镜像构建问题"
    echo "2. 依赖安装失败"
    echo "3. 网络连接问题"
    echo ""
    echo "解决方案:"
    echo "1. 重新运行脚本"
    echo "2. 检查网络连接"
    echo "3. 清理 Docker 缓存: docker system prune"
    echo ""
    exit 1
fi
