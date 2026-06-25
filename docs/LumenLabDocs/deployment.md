# 部署

> 本文档面向希望自行部署 LumenLab 的开发者。当前版本提供「用户自带 API Key」自托管模式，无需连接中央注册码管理端。

## 自托管快速开始

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

## 回退到中央管理模式

将 `USER_API_KEYS_ENABLED` 改为 `0` 或 `false`，并确保用户已关联有效的 `CredentialProfile`（通过注册码注册）。

普通用户请优先阅读：
- [快速开始](./getting-started.md)
- [产品概览](./overview.md)
