module.exports = {
  apps: [{
    // 应用基本配置
    name: 'xianyu-monitor',
    script: 'server.js',
    
    // 实例配置
    instances: process.env.NODE_ENV === 'production' ? 'max' : 1,
    exec_mode: process.env.NODE_ENV === 'production' ? 'cluster' : 'fork',
    
    // 环境变量
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_staging: {
      NODE_ENV: 'staging',
      PORT: 3001
    },
    
    // 日志配置
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true,
    
    // 监控配置
    monitoring: false, // 关闭PM2内置监控
    pmx: false,
    
    // 重启配置
    autorestart: true,
    watch: process.env.NODE_ENV === 'development',
    watch_delay: 1000,
    ignore_watch: [
      'node_modules',
      'logs',
      'public/uploads',
      'public/exports',
      '.git'
    ],
    
    // 内存和CPU限制
    max_memory_restart: '500M',
    min_uptime: '10s',
    max_restarts: 5,
    restart_delay: 4000,
    
    // 优雅退出
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    
    // 集群配置
    instance_var: 'INSTANCE_ID',
    
    // 启动配置
    node_args: '--max-old-space-size=256',
    
    // 健康检查
    health_check_url: 'http://localhost:3000/api/health',
    health_check_grace_period: 3000
  }],
  
  // 部署配置
  deploy: {
    production: {
      user: 'nodeuser',
      host: ['your-server-ip'],
      ref: 'origin/main',
      repo: 'https://github.com/your-username/xianyu-monitor.git',
      path: '/home/nodeuser/projects/xianyu-monitor',
      
      // 部署钩子
      'pre-deploy-local': '',
      'post-deploy': 'npm install --only=production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      
      // SSH配置
      ssh_options: 'StrictHostKeyChecking=no',
      
      // 环境变量
      env: {
        NODE_ENV: 'production'
      }
    },
    
    staging: {
      user: 'nodeuser',
      host: ['your-staging-server-ip'],
      ref: 'origin/develop',
      repo: 'https://github.com/your-username/xianyu-monitor.git',
      path: '/home/nodeuser/projects/xianyu-monitor-staging',
      
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env staging',
      
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
};
