#!/bin/bash

# ========================================
# Windsurf-Tool macOS 打包脚本 (最优方案)
# ========================================
# 支持 Intel (x64) 和 Apple Silicon (arm64)
# 自动代码加密、权限设置、优化打包

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印函数
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

# 检查系统
check_system() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        print_error "此脚本只能在 macOS 上运行"
        exit 1
    fi
    
    print_success "系统检查通过 (macOS)"
}

# 检查依赖
check_dependencies() {
    print_info "检查依赖..."
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        print_error "未找到 Node.js"
        echo "请安装: https://nodejs.org/"
        exit 1
    fi
    print_success "Node.js: $(node --version)"
    
    # 检查 npm
    if ! command -v npm &> /dev/null; then
        print_error "未找到 npm"
        exit 1
    fi
    print_success "npm: $(npm --version)"
    
    # 检查 node_modules
    if [ ! -d "node_modules" ]; then
        print_warning "依赖未安装"
        print_info "正在安装依赖..."
        npm install
        if [ $? -ne 0 ]; then
            print_error "依赖安装失败"
            exit 1
        fi
    fi
    print_success "依赖已安装"
}

# 清理旧文件
clean_old_builds() {
    print_info "清理旧的打包文件..."
    
    rm -rf dist/*.dmg 2>/dev/null || true
    rm -rf dist/*.zip 2>/dev/null || true
    rm -rf dist/mac 2>/dev/null || true
    rm -rf dist/mac-arm64 2>/dev/null || true
    rm -rf dist/.icon-* 2>/dev/null || true
    
    print_success "清理完成"
}

# 显示打包选项
show_options() {
    print_header "🍎 macOS 打包选项"
    
    echo "请选择打包架构:"
    echo ""
    echo "  1) Universal (x64 + arm64) - 推荐"
    echo "  2) Intel only (x64)"
    echo "  3) Apple Silicon only (arm64)"
    echo "  4) 分别打包 x64 和 arm64"
    echo ""
}

# 打包 Universal
build_universal() {
    print_header "📦 打包 Universal 版本 (x64 + arm64)"
    
    print_info "开始打包..."
    npm run build:mac
    
    if [ $? -eq 0 ]; then
        print_success "Universal 打包完成"
    else
        print_error "打包失败"
        exit 1
    fi
}

# 打包 x64
build_x64() {
    print_header "📦 打包 Intel (x64) 版本"
    
    print_info "开始打包..."
    npm run build:mac:x64
    
    if [ $? -eq 0 ]; then
        print_success "x64 打包完成"
    else
        print_error "打包失败"
        exit 1
    fi
}

# 打包 arm64
build_arm64() {
    print_header "📦 打包 Apple Silicon (arm64) 版本"
    
    print_info "开始打包..."
    npm run build:mac:arm64
    
    if [ $? -eq 0 ]; then
        print_success "arm64 打包完成"
    else
        print_error "打包失败"
        exit 1
    fi
}

# 分别打包
build_separate() {
    print_header "📦 分别打包 x64 和 arm64"
    
    print_info "打包 x64..."
    npm run build:mac:x64
    
    print_info "打包 arm64..."
    npm run build:mac:arm64
    
    if [ $? -eq 0 ]; then
        print_success "所有架构打包完成"
    else
        print_error "打包失败"
        exit 1
    fi
}

# 显示结果
show_results() {
    print_header "✅ 打包完成"
    
    if [ ! -d "dist" ]; then
        print_error "未找到 dist 目录"
        exit 1
    fi
    
    print_info "生成的文件:"
    echo ""
    
    # 统计文件
    local dmg_count=0
    local zip_count=0
    local total_size=0
    
    # 列出 DMG 文件
    if ls dist/*.dmg 1> /dev/null 2>&1; then
        echo -e "${GREEN}📦 DMG 安装包:${NC}"
        for file in dist/*.dmg; do
            if [ -f "$file" ]; then
                size=$(ls -lh "$file" | awk '{print $5}')
                name=$(basename "$file")
                echo "  • $name ($size)"
                dmg_count=$((dmg_count + 1))
            fi
        done
        echo ""
    fi
    
    # 列出 ZIP 文件
    if ls dist/*.zip 1> /dev/null 2>&1; then
        echo -e "${GREEN}📦 ZIP 压缩包:${NC}"
        for file in dist/*.zip; do
            if [ -f "$file" ]; then
                size=$(ls -lh "$file" | awk '{print $5}')
                name=$(basename "$file")
                echo "  • $name ($size)"
                zip_count=$((zip_count + 1))
            fi
        done
        echo ""
    fi
    
    # 总结
    print_success "共生成 $dmg_count 个 DMG 和 $zip_count 个 ZIP 文件"
    print_success "输出目录: ./dist/"
    echo ""
    
    # 说明
    print_info "文件说明:"
    echo "  • DMG 文件 - macOS 安装包（推荐分发）"
    echo "  • ZIP 文件 - 便携版压缩包"
    echo "  • x64 - Intel Mac 版本"
    echo "  • arm64 - Apple Silicon 版本"
    echo ""
    
    # 特性说明
    print_info "打包特性:"
    echo "  ✅ 代码已加密混淆"
    echo "  ✅ Python 脚本权限已设置"
    echo "  ✅ 资源文件已包含"
    echo "  ✅ 无需代码签名即可运行"
    echo ""
    
    # 测试建议
    print_warning "测试建议:"
    echo "  1. 在 Intel Mac 上测试 x64 版本"
    echo "  2. 在 Apple Silicon Mac 上测试 arm64 版本"
    echo "  3. 检查所有功能是否正常"
    echo ""
}

# 主函数
main() {
    print_header "🍎 Windsurf-Tool macOS 打包工具"
    
    # 1. 检查系统
    check_system
    
    # 2. 检查依赖
    check_dependencies
    echo ""
    
    # 3. 清理旧文件
    clean_old_builds
    echo ""
    
    # 4. 显示选项
    show_options
    
    # 5. 读取用户选择
    read -p "请选择 [1-4, 默认: 1]: " choice
    choice=${choice:-1}
    echo ""
    
    # 6. 执行打包
    case $choice in
        1)
            build_universal
            ;;
        2)
            build_x64
            ;;
        3)
            build_arm64
            ;;
        4)
            build_separate
            ;;
        *)
            print_error "无效的选择"
            exit 1
            ;;
    esac
    
    # 7. 显示结果
    show_results
}

# 运行主函数
main
