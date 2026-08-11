# 部署

> 本文档面向 LumenLab 的部署与运维人员，介绍通用的自托管方式。普通用户请阅读 [快速开始](./getting-started.md)。

## 自托管准备

### 1. 准备环境

- Node.js 20+
- PostgreSQL 16 + pgvector
- Redis 7（可选；多实例和生产环境建议启用）
- DeepSeek / MiniMax / MinerU / Bailian 中与你要使用的能力对应的凭据
- 腾讯云 SES 邮件服务凭据（注册邮箱验证与密码重置邮件；未配置时本地开发回退为控制台 dry-run）
- 生产文件存储建议使用七牛云 Kodo；开发环境可回退到本地存储

复制配置并按 [配置参考](./reference/configuration.md) 填写：

```bash
cp .env.example .env
npm ci
npx prisma generate
npx prisma migrate deploy
```

### 2. 选择账号与凭据模式

中央管理模式需要独立的 [course-ai-regadmin](https://github.com/mkynyd/course-ai-regadmin) 发布注册码和加密凭据快照。

单机自托管可开启用户 API Key 模式，并用种子脚本创建本地账号。`DEV_USER_PASSWORD` 必须显式设置，种子脚本不提供默认密码：

```bash
USER_API_KEYS_ENABLED=1 \
DEV_USER_EMAIL=dev@example.com \
DEV_USER_PASSWORD='replace-with-a-strong-password' \
DEV_DEEPSEEK_API_KEY='sk-...' \
npm run seed:dev-access
```

还可提供 `DEV_MINIMAX_API_KEY`、`DEV_MINERU_API_KEY`、`DEV_BAILIAN_API_KEY`。已有用户可使用 `npm run setup:api-key -- --email=... --provider=... --key=...` 单独写入凭据。

能力与 provider 的最小关系：

| 能力 | 需要的 provider |
|---|---|
| DeepSeek 文字聊天 | `deepseek` |
| 图片 / PDF 项目解析、MiniMax 聊天 | `minimax` |
| Office/WPS/iWork 与 `/tools` PDF 转 Markdown | `mineru` |
| 向量检索 | `bailian`，缺失时降级为关键词检索 |
| Qwen3.7-Plus 聊天 | `bailian` + `MODEL_QWEN_ENABLED=true` + `BAILIAN_WORKSPACE_ID` |

### 3. 启动

开发环境：

```bash
npm run dev
```

生产环境先构建再启动：

```bash
npm run build
npm start
```

## 生产部署

生产部署由三部分组成：环境变量、反向代理和进程管理。

### 环境变量

- 按 [配置参考](./reference/configuration.md) 在服务器上准备 `.env`，`AUTH_URL` 必须与最终对外访问的域名一致。
- `.env` 只放在服务器上，不要提交到仓库。

### 反向代理

使用 Nginx、Caddy 或任意反向代理，把 HTTPS 流量转发到应用监听的本机端口（默认 `127.0.0.1:3000`）：

- SSE 流式输出需要关闭代理缓冲（Nginx 为 `proxy_buffering off`）。
- 上传限制建议不低于 400MB，以覆盖应用的 300MB 批量上传和 multipart 开销。
- 可将 `/_next/static` 交给反向代理直接提供，减轻 Node 进程压力。

### 进程管理

使用 systemd、pm2 或 Docker 守护 Node 进程，并配置异常退出自动重启。应用暴露 `/api/health` 健康检查端点，可用于进程管理器与反向代理的存活探测。

使用 standalone 输出时，注意把 `.next/static` 与 `public` 一并复制到运行目录。

## 发布前检查

```bash
npm run lint
npx tsc --noEmit
npm test -- --run
npx prisma validate
npx prisma migrate status
npm run build
git diff --check
```

部署后检查 `/api/health`、登录注册、SSE 流式聊天、文件上传与导出，并确认日志中没有泄露 API Key、同步密钥或 RSA 私钥。
