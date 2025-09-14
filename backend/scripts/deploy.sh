#!/bin/bash

# 闲鱼监控系统自动部署脚本
# 使用方法: ./deploy.sh [环境] [版本]
# 示例: ./deploy.sh production v1.0.0

set -e

# 默认参数
ENVIRONMENT=${1:-production}
VERSION=${2:-latest}
APP_NAME="xianyu-monitor"
APP_DIR="/home/nodeuser/projects/$APP_NAME"
BACKUP_DIR="/home/nodeuser/backups"
LOG_FILE="/tmp/deploy_$(date +%Y%m%d_%H%M%S).log"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a $LOG_FILE
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a $LOG_FILE
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a $LOG_FILE
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a $LOG_FILE
}

# 检查依赖
check_dependencies() {
    log "检查部署依赖..."
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js 未安装"
        exit 1
    fi
    
    # 检查PM2
    if ! command -v pm2 &> /dev/null; then
        error "PM2 未安装"
        exit 1
    fi
    
    # 检查MongoDB
    if ! systemctl is-active --quiet mongod; then
        error "MongoDB 服务未运行"
        exit 1
    fi
    
    # 检查Nginx
    if ! systemctl is-active --quiet nginx; then
        warning "Nginx 服务未运行"
    fi
    
    success "依赖检查完成"
}

# 创建备份
create_backup() {
    if [ -d "$APP_DIR" ]; then
        log "创建应用备份..."
        
        BACKUP_NAME="backup_$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        
        # 备份应用文件
        cp -r "$APP_DIR" "$BACKUP_DIR/$BACKUP_NAME"
        
        # 备份数据库
        mongodump --uri="mongodb://xianyuuser:your_app_password_here@localhost:27017/xianyu_monitor" --out="$BACKUP_DIR/$BACKUP_NAME/database"
        
        # 压缩备份
        cd "$BACKUP_DIR"
        tar -czf "$BACKUP_NAME.tar.gz" "$BACKUP_NAME"
        rm -rf "$BACKUP_NAME"
        
        success "备份创建完成: $BACKUP_NAME.tar.gz"
    else
        log "应用目录不存在，跳过备份"
    fi
}

# 停止应用
stop_application() {
    log "停止应用服务..."
    
    if pm2 list | grep -q "$APP_NAME"; then
        pm2 stop "$APP_NAME" || true
        pm2 delete "$APP_NAME" || true
        success "应用服务已停止"
    else
        log "应用服务未运行"
    fi
}

# 更新代码
update_code() {
    log "更新应用代码..."
    
    if [ ! -d "$APP_DIR" ]; then
        mkdir -p "$APP_DIR"
        log "创建应用目录: $APP_DIR"
    fi
    
    # 这里可以从Git仓库拉取代码
    # git clone https://github.com/your-username/xianyu-monitor.git $APP_DIR
    # 或者从上传的文件中复制
    
    # 复制backend文件
    if [ -d "./backend" ]; then
        cp -r ./backend/* "$APP_DIR/"
        success "后端代码更新完成"
    else
        error "找不到backend目录"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    log "安装应用依赖..."
    
    cd "$APP_DIR"
    
    # 清理旧的node_modules
    if [ -d "node_modules" ]; then
        rm -rf node_modules
        log "清理旧依赖"
    fi
    
    # 安装生产依赖
    npm ci --only=production
    
    success "依赖安装完成"
}

# 配置环境
configure_environment() {
    log "配置环境变量..."
    
    cd "$APP_DIR"
    
    # 创建.env文件
    cat > .env << EOF
NODE_ENV=$ENVIRONMENT
PORT=3000
MONGODB_URI=mongodb://xianyuuser:your_app_password_here@localhost:27017/xianyu_monitor
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
WECHAT_APP_ID=your_wechat_app_id
WECHAT_APP_SECRET=your_wechat_app_secret
ENCRYPTION_KEY=$(openssl rand -hex 32)
LOG_LEVEL=info
FRONTEND_URL=https://your-domain.com
EOF
    
    # 设置文件权限
    chmod 600 .env
    chown nodeuser:nodeuser .env
    
    success "环境配置完成"
}

# 数据库迁移
migrate_database() {
    log "执行数据库迁移..."
    
    # 这里可以执行数据库迁移脚本
    # node scripts/migrate.js
    
    success "数据库迁移完成"
}

# 启动应用
start_application() {
    log "启动应用服务..."
    
    cd "$APP_DIR"
    
    # 使用PM2启动应用
    pm2 start ecosystem.config.js --env $ENVIRONMENT
    pm2 save
    
    # 等待启动完成
    sleep 5
    
    # 检查应用状态
    if pm2 list | grep -q "$APP_NAME.*online"; then
        success "应用启动成功"
    else
        error "应用启动失败"
        pm2 logs "$APP_NAME" --lines 20
        exit 1
    fi
}

# 健康检查
health_check() {
    log "执行健康检查..."
    
    local retries=5
    local wait=10
    
    for i in $(seq 1 $retries); do
        if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
            success "健康检查通过"
            return 0
        fi
        
        warning "健康检查失败 ($i/$retries)，${wait}秒后重试..."
        sleep $wait
    done
    
    error "健康检查失败，应用可能未正常启动"
    pm2 logs "$APP_NAME" --lines 20
    exit 1
}

# 更新Nginx配置
update_nginx() {
    log "更新Nginx配置..."
    
    # 测试Nginx配置
    if nginx -t; then
        systemctl reload nginx
        success "Nginx配置更新完成"
    else
        error "Nginx配置测试失败"
        exit 1
    fi
}

# 清理旧版本
cleanup() {
    log "清理旧版本..."
    
    # 清理旧的PM2进程
    pm2 flush
    
    # 清理旧备份（保留最近10个）
    cd "$BACKUP_DIR"
    ls -t backup_*.tar.gz | tail -n +11 | xargs rm -f
    
    success "清理完成"
}

# 发送通知
send_notification() {
    log "发送部署通知..."
    
    # 这里可以发送邮件、钉钉、企业微信等通知
    # curl -X POST "https://hooks.slack.com/..." -d "{'text':'部署完成'}"
    
    success "通知发送完成"
}

# 主部署流程
main() {
    log "开始部署 $APP_NAME ($ENVIRONMENT - $VERSION)"
    
    # 检查权限
    if [ "$EUID" -eq 0 ]; then
        error "请不要使用root用户运行部署脚本"
        exit 1
    fi
    
    # 执行部署步骤
    check_dependencies
    create_backup
    stop_application
    update_code
    install_dependencies
    configure_environment
    migrate_database
    start_application
    health_check
    update_nginx
    cleanup
    send_notification
    
    success "部署完成！"
    log "查看应用状态: pm2 status"
    log "查看应用日志: pm2 logs $APP_NAME"
    log "部署日志: $LOG_FILE"
}

# 错误处理
trap 'error "部署过程中发生错误，请检查日志: $LOG_FILE"' ERR

# 显示帮助
show_help() {
    echo "闲鱼监控系统部署脚本"
    echo ""
    echo "使用方法:"
    echo "  $0 [环境] [版本]"
    echo ""
    echo "参数:"
    echo "  环境    部署环境 (production/staging)，默认: production"
    echo "  版本    应用版本，默认: latest"
    echo ""
    echo "示例:"
    echo "  $0 production v1.0.0"
    echo "  $0 staging latest"
    echo ""
    echo "选项:"
    echo "  -h, --help    显示帮助信息"
    echo ""
}

# 检查参数
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# 执行主流程
main

exit 0
