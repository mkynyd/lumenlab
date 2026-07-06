# 部署

> 本文档面向希望自行部署 LumenLab 的开发者或管理员。自托管模式下，由你负责部署、数据库和 API Key 的管理，无需连接任何外部中央注册码管理端。普通用户请直接阅读 [快速开始](./getting-started.md)。

## 自托管快速开始

### 0. 准备运行环境

- Node.js 20+
- PostgreSQL 16 + pgvector
- Redis 7（可选，但生产建议配置）
- 可用的 DeepSeek / MiniMax / MinerU / Bailian 凭证，或由管理端同步的中央凭证组
- 生产文件存储建议配置七牛云 Kodo 私有空间

### 1. 启用用户自定义 API Key

修改 `src/lib/config.ts` 或设置环境变量：

```bash
USER_API_KEYS_ENABLED=1
```

开启后，系统会优先读取每个用户自己的 `ApiKey` 记录；没有时才会回退到中央 `CredentialProfile`（中央管理模式）。

### 2. 准备数据库与加密密钥

确保 `.env` 中已配置：

```bash
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=... # 64 字符 hex，用于加密用户 API Key
```

然后执行：

```bash
npx prisma migrate deploy
```

### 3. 注册账号

按普通用户流程注册一个账号，记录登录邮箱。

### 4. 为用户设置 API Key

**方式 A：命令行脚本（推荐，无需前端）**

```bash
USER_API_KEYS_ENABLED=1 npx tsx scripts/setup-api-key.ts \
  --email=user@example.com \
  --provider=deepseek \
  --key=sk-xxx
```

支持 provider：`deepseek`、`minimax`、`mineru`、`bailian`。

最小可用组合：

- 普通文字聊天：DeepSeek。
- 图片和 PDF 项目解析：MiniMax。
- Office/WPS/iWork 项目解析和 `/tools` PDF 转 Markdown：MinerU。
- 向量检索：Bailian，缺失时可降级为关键词检索。

**方式 B：调用 API 路由**

先登录获取会话 Cookie，然后：

```bash
curl -X POST http://localhost:3000/api/user/api-keys \
  -H "Content-Type: application/json" \
  -b "session-cookie" \
  -d '{"provider":"deepseek","apiKey":"sk-xxx"}'
```

> 注意：`/api/user/api-keys` 仅在 `USER_API_KEYS_ENABLED=1` 时可用，默认关闭，避免普通用户误操作。

### 5. 启动应用

```bash
npm install
npm run dev   # 或 npm run build && npm start
```

生产构建使用 Next.js standalone 输出：

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

反向代理需要注意：

- SSE 聊天接口关闭代理缓冲。
- 上传限制建议不低于 400MB，以覆盖应用的 50MB 单文件、300MB 批量校验前置过程和 Next.js proxy 上限。
- `/_next/static` 可由 Nginx / Caddy 直接服务。

## 回退到中央管理模式

将 `USER_API_KEYS_ENABLED` 改为 `0` 或 `false`，并确保用户已关联有效的 `CredentialProfile`（通过注册码注册）。

普通用户请优先阅读：
- [快速开始](./getting-started.md)
- [产品概览](./overview.md)
