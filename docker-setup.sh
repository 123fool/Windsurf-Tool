#!/bin/bash

# Docker 环境安装脚本
echo "========================================"
echo "🐳 Docker 环境安装向导"
echo "========================================"
echo ""

# 检测操作系统
OS="$(uname -s)"
case "${OS}" in
    Darwin*)    MACHINE=Mac;;
    Linux*)     MACHINE=Linux;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo "检测到操作系统: $MACHINE"
echo ""

if [ "$MACHINE" = "Mac" ]; then
    echo "📱 macOS Docker 安装步骤:"
    echo ""
    echo "方法1: 官方下载 (推荐)"
    echo "1. 访问: https://www.docker.com/products/docker-desktop/"
    echo "2. 点击 'Download for Mac'"
    echo "3. 选择适合你的芯片版本:"
    echo "   - Intel 芯片: Docker Desktop for Mac with Intel chip"
    echo "   - Apple 芯片: Docker Desktop for Mac with Apple chip"
    echo "4. 下载完成后双击 .dmg 文件安装"
    echo "5. 将 Docker 拖拽到 Applications 文件夹"
    echo "6. 启动 Docker Desktop"
    echo ""
    
    echo "方法2: Homebrew 安装"
    echo "1. 安装 Homebrew (如果未安装):"
    echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    echo "2. 安装 Docker Desktop:"
    echo "   brew install --cask docker"
    echo "3. 启动 Docker Desktop"
    echo ""
    
    # 检查是否已安装 Homebrew
    if command -v brew &> /dev/null; then
        echo "✓ 检测到 Homebrew 已安装"
        read -p "是否使用 Homebrew 自动安装 Docker? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "🍺 正在通过 Homebrew 安装 Docker Desktop..."
            brew install --cask docker
            if [ $? -eq 0 ]; then
                echo "✅ Docker Desktop 安装完成!"
                echo "请手动启动 Docker Desktop 应用"
            else
                echo "❌ 安装失败，请手动下载安装"
            fi
        fi
    fi
    
elif [ "$MACHINE" = "Linux" ]; then
    echo "🐧 Linux Docker 安装步骤:"
    echo ""
    
    # 检测 Linux 发行版
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
    else
        DISTRO="unknown"
    fi
    
    echo "检测到 Linux 发行版: $DISTRO"
    echo ""
    
    case "$DISTRO" in
        ubuntu|debian)
            echo "Ubuntu/Debian 安装命令:"
            echo "sudo apt-get update"
            echo "sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release"
            echo "curl -fsSL https://download.docker.com/linux/$DISTRO/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg"
            echo "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$DISTRO \$(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null"
            echo "sudo apt-get update"
            echo "sudo apt-get install -y docker-ce docker-ce-cli containerd.io"
            echo "sudo systemctl start docker"
            echo "sudo systemctl enable docker"
            echo "sudo usermod -aG docker \$USER"
            ;;
        centos|rhel|fedora)
            echo "CentOS/RHEL/Fedora 安装命令:"
            echo "sudo yum install -y yum-utils"
            echo "sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo"
            echo "sudo yum install -y docker-ce docker-ce-cli containerd.io"
            echo "sudo systemctl start docker"
            echo "sudo systemctl enable docker"
            echo "sudo usermod -aG docker \$USER"
            ;;
        *)
            echo "其他发行版请参考官方文档:"
            echo "https://docs.docker.com/engine/install/"
            ;;
    esac
    
    echo ""
    read -p "是否自动执行安装命令? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🚀 开始自动安装 Docker..."
        if [ "$DISTRO" = "ubuntu" ] || [ "$DISTRO" = "debian" ]; then
            sudo apt-get update
            sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
            curl -fsSL https://download.docker.com/linux/$DISTRO/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$DISTRO $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            sudo apt-get update
            sudo apt-get install -y docker-ce docker-ce-cli containerd.io
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            echo "✅ Docker 安装完成! 请重新登录以使用 Docker"
        fi
    fi
    
else
    echo "❌ 不支持的操作系统: $MACHINE"
    echo "请访问 Docker 官网手动安装: https://www.docker.com/get-started"
fi

echo ""
echo "========================================"
echo "📋 安装完成后的验证步骤"
echo "========================================"
echo ""
echo "1. 验证 Docker 是否安装成功:"
echo "   docker --version"
echo ""
echo "2. 验证 Docker 是否运行:"
echo "   docker info"
echo ""
echo "3. 测试 Docker 运行:"
echo "   docker run hello-world"
echo ""
echo "4. 如果一切正常，运行打包脚本:"
echo "   ./docker-build.sh"
echo ""

# 检查 Docker 是否已安装
if command -v docker &> /dev/null; then
    echo "✅ Docker 已安装，版本: $(docker --version)"
    
    # 检查 Docker 是否运行
    if docker info &> /dev/null 2>&1; then
        echo "✅ Docker 服务正在运行"
        echo ""
        echo "🎉 环境准备完成! 可以直接运行:"
        echo "   ./docker-build.sh"
    else
        echo "⚠️  Docker 已安装但未运行，请启动 Docker 服务"
    fi
else
    echo "⚠️  Docker 未安装，请按照上述步骤安装"
fi
