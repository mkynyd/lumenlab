# 部署

> 本文档面向 LumenLab 的部署与运维人员，覆盖当前生产发布流程和独立自托管方式。普通用户请阅读 [快速开始](./getting-started.md)。

## 当前生产架构

LumenLab 已运行在 [lab.mkynstudio.top](https://lab.mkynstudio.top)，在线文档位于 [/docs](https://lab.mkynstudio.top/docs)。当前生产路径为：

```text
用户 → Nginx HTTPS
     → 127.0.0.1:3000（Next.js standalone，systemd lumenlab.service）
     → PostgreSQL 16 + pgvector / Redis 7（本机环回）
     → 七牛云 Kodo（私有对象存储）
     → course-ai-regadmin（加密注册码与凭据快照）
```

应用采用 release 目录和 `current` 符号链接，环境变量、上传文件与 `.lumenlab` 数据独立于每次发布：

```text
/www/wwwroot/course-ai-lab/
├── .env
├── uploads/
├── .lumenlab/
├── releases/<commit>/
├── current -> releases/<commit>
└── build/
```

## 官方发布与回滚

仓库内 `scripts/deploy.sh` 是当前生产发布入口，默认通过 SSH alias `remoteDev` 连接服务器，也可通过 `DEPLOY_SSH_HOST` 覆盖。

```bash
# 首次迁移：安装 systemd unit、调整 Nginx 并部署首个 release
./scripts/deploy.sh bootstrap

# 部署指定 commit；省略 commit 时使用 origin/main
./scripts/deploy.sh deploy <commit>

# 回滚到保留的上一 release
./scripts/deploy.sh rollback

# 查看 current、release、systemd、健康状态和磁盘余量
./scripts/deploy.sh status
```

部署流程会验证目标 commit 的 GitHub Actions CI，创建数据库快照，执行 Prisma migration 和生产构建，在 3002 端口完成预检，再原子切换 `current` 并检查本机与 HTTPS 健康端点。失败时恢复上一 release。服务器只保留当前版本与最近一个可回滚版本，数据库快照保留最近 3 份。

### CI 门禁

push 到 `main` 会触发 `.github/workflows/ci.yml`：

- Ubuntu：`npm ci`、Prisma generate、lockfile 不可变检查、lint、TypeScript、全量测试、pgvector migration、生产构建和 whitespace check。
- macOS：`npm ci` 与 lockfile 一致性检查。

历史 commit 没有 CI 记录时，部署脚本只允许显式添加 `--skip-ci-check`；pending 或失败状态不能绕过。

### Nginx 与 systemd

- Nginx 反向代理到 `127.0.0.1:3000`，SSE 路径需要 `proxy_buffering off`。
- 上传限制应不低于 400MB，以覆盖应用的 300MB 批量上传和 multipart 开销。
- `/_next/static` 固定指向 `current/.next/static`。
- systemd unit 位于 `deploy/lumenlab.service`，工作目录为 `current`，停止超时 20 秒，异常退出自动重启。
- `/api/health` 同时检查 PostgreSQL 和 Redis：数据库失败为 `unhealthy` / HTTP 503，Redis 单独失败为 `degraded` / HTTP 200。

## 独立自托管

### 1. 准备环境

- Node.js 20+
- PostgreSQL 16 + pgvector
- Redis 7（可选；多实例和生产环境建议启用）
- DeepSeek / MiniMax / MinerU / Bailian 中与你要使用的能力对应的凭据
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

单机自托管可开启用户 API Key 模式，并用种子脚本创建本地账号：

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

通用生产环境可先使用 Next.js start 验证：

```bash
npm run build
npm start
```

正式 standalone 部署还需要复制 `.next/static`、`public`、`.lumenlab` 和持久化目录。可参考仓库的 `scripts/deploy.sh` 与 `deploy/lumenlab.service`，根据自己的服务器路径改写，不要直接复用其中的域名与绝对路径。

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
