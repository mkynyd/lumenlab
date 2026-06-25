# 配置与环境变量

> 本文档面向开发者与自托管用户，列出运行 LumenLab 所需的环境变量。配置项主要来源于 `.env.example` 与 `src/lib/config.ts`。

---

## 核心变量表

| 变量名 | 是否必需 | 默认值 / 示例 | 用途 |
|---|---|---|---|
| `DATABASE_URL` | 必需 | `postgresql://postgres:postgres@localhost:5432/ai_workspace?schema=public` | PostgreSQL 连接串，需启用 `pgvector` 扩展 |
| `REDIS_URL` | 可选 | `redis://localhost:6379` | 共享缓存与限流存储；不可用时回退到内存 |
| `AUTH_SECRET` | 必需 | `please-change-this` | Auth.js v5 会话签名密钥，建议用 `openssl rand -base64 32` 生成 |
| `AUTH_URL` | 必需 | `https://lab.mkynstudio.top` | 认证回调地址，需与最终访问域名一致 |
| `ENCRYPTION_KEY` | 必需 | `please-generate-a-64-char-hex-string` | AES-256-GCM 加密密钥，需 64 位十六进制字符；用 `openssl rand -hex 32` 生成 |
| `REGISTRATION_CODE_PEPPER` | 必需 | — | Alpha 注册码哈希胡椒值，与管理端使用同一值 |
| `REGISTRATION_SYNC_SECRET` | 必需 | — | 注册码同步请求校验密钥，与管理端使用同一值 |
| `REGISTRATION_SYNC_PRIVATE_KEY_BASE64` | 必需 | — | Base64 编码的 RSA 私钥 PEM，用于解密注册码同步快照 |
| `DEEPSEEK_BASE_URL` | 必需 | `https://api.deepseek.com` | DeepSeek API 基础地址 |
| `QINIU_ACCESS_KEY` | 必需 | — | 七牛云 Access Key |
| `QINIU_SECRET_KEY` | 必需 | — | 七牛云 Secret Key，仅服务端使用 |
| `QINIU_BUCKET` | 必需 | `course-ai-lab` | 七牛云存储空间名 |
| `QINIU_REGION` | 必需 | `z2` | 七牛云存储区域 |
| `QINIU_UPLOAD_HOST` | 必需 | `https://up-z2.qiniup.com` | 七牛云上传域名 |
| `QINIU_PRIVATE_DOMAIN` | 必需 | `coursecdn.mkynstudio.top` | 七牛云私有下载域名 |
| `NEXT_PUBLIC_APP_NAME` | 必需 | `LumenLab` | 前端展示的应用名称 |
| `USER_API_KEYS_ENABLED` | 可选 | `false` | 自托管开关；设为 `1` 或 `true` 时优先读取用户自行配置的 API Key |
| `CACHE_EXPERIMENT_PROMPT_REORDER` | 可选 | `false` | 是否启用提示词重排实验 |
| `CACHE_EXPERIMENT_REORDER_STRATEGY` | 可选 | `rag-to-last-user` | 提示词重排策略 |
| `CACHE_EXPERIMENT_MINIMAX_ACTIVE` | 可选 | `false` | 是否启用 MiniMax 模型缓存实验 |

---

## 补充说明

### 密钥生成

- `AUTH_SECRET`：至少 32 字节，建议 `openssl rand -base64 32`。
- `ENCRYPTION_KEY`：固定 64 字符十六进制，对应 32 字节，建议 `openssl rand -hex 32`。
- `REGISTRATION_CODE_PEPPER` 与 `REGISTRATION_SYNC_SECRET`：各自独立生成，长度建议不低于 48 字节，例如 `openssl rand -base64 48`。
- `REGISTRATION_SYNC_PRIVATE_KEY_BASE64`：将 RSA 私钥 PEM 文件进行 Base64 编码后填入。

### 数据库

`DATABASE_URL` 指向的 PostgreSQL 实例必须安装并启用 `pgvector` 扩展，用于向量检索与 RRF 融合。

### Redis

`REDIS_URL` 为可选项。未配置或连接失败时，应用会使用内存作为降级缓存与限流存储；多实例部署时建议配置 Redis。

### 自托管模式

`src/lib/config.ts` 中的 `USER_API_KEYS_ENABLED` 控制部署模式：

- 默认 `false`：使用 `CredentialProfile` 中的中央密钥组（Alpha 注册码流程）。
- 设为 `1` 或 `true`：优先读取 `ApiKey` 表中用户自行提供的 API Key，未找到时回退到中央密钥组。

该开关没有前端 UI，需由部署者通过环境变量控制。

### 缓存实验开关

`CACHE_EXPERIMENT_*` 系列变量用于逐步验证缓存优化效果。建议在收集基线指标前保持默认关闭状态。
