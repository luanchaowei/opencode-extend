# OpenCode Extend

OpenCode 自定义前端，支持按客户端IP进行权限隔离。

## 详细文档

- [安装指南](doc/install-guide.md) - 环境要求、部署说明、安装配置和启动方法
- [使用指南](doc/user-guide.md) - 面向终端用户，按模块详细介绍各功能使用方法
- [运维指南](doc/admin-guide.md) - 面向管理员，登录认证、统计面板、系统监控、系统设置和用户管理说明
- [API 接口文档](doc/api-reference.md) - 全部 HTTP API 接口的路径、参数、响应和权限说明
- [数据库表结构](doc/database-schema.md) - stats.db 的表结构、字段、索引和存储规则
- [工具脚本指南](doc/tools-guide.md) - 会话清理和统计数据库查询工具的使用方法
- [编译打包指南](doc/build-guide.md) - 编译为独立可执行文件

## 项目结构

```
opencode-extend/
├── packages/
│   ├── app/      # 前端应用
│   ├── scripts/  # 工具脚本
│   ├── ui/       # UI 组件
│   ├── sdk/      # SDK
│   └── core/     # 工具库
├── doc/          # 文档
├── .env          # 环境配置
├── restart.sh    # 前端启动脚本（bash restart.sh [dev|prod] [--build]）
├── stop.sh       # 前端停止脚本
├── server.sh     # 后端服务管理脚本（start/stop/restart/status）
├── build.sh      # 编译打包脚本
└── package.json
```

## 许可证

MIT
