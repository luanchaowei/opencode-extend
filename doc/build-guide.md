# 编译打包指南

## 环境要求

- Bun >= 1.3.13

## 编译

```bash
bash build.sh
```

## 产物

| 文件 | 说明 |
|------|------|
| `dist-bin/opencode-extend` | 可执行文件（约 121MB） |
| `dist-bin/opencode-extend.tar.gz` | 安装包（约 45MB），包含可执行文件 + .env.example |

## 部署

```bash
# 解压
tar xzf opencode-extend.tar.gz

# 配置
cp .env.example .env
vim .env

# 启动
./opencode-extend
```

也可直接通过命令行传环境变量，不使用 .env 文件：

```bash
WEB_HOST=0.0.0.0 WEB_PORT=3000 VITE_OPENCODE_SERVER_HOST=127.0.0.1 ./opencode-extend
```
