# LumenLab

> 更新时间：2026-06-22
>
> 总结范围：当前仓库、Git 提交记录、生产部署状态
>
> 本地目录仍为 `light-ai-chat`，产品与 GitHub 项目名称已统一为 `LumenLab`

## 项目架构梳理与现状审查

最初对仓库进行了完整架构核对，确认项目采用 Next.js 16.2 App Router、React 19、TypeScript、Auth.js v5、Prisma 7、PostgreSQL 与 pgvector。

当时的结论是：普通聊天已经可以运行，但项目工作台仍有明显断点。项目页虽然保存了 `projectId`、`selectedFileIds` 和任务模式，前端聊天请求却没有把这些字段传给 `/api/chat`；快捷任务也没有真正填入输入框。RAG 仅有文本切块和向量字段骨架，embedding 生成尚未接入。

后续已接入 qwen3-vl-embedding 融合模式，DocumentChunk 支持文本与图片/视频融合嵌入。

审查还发现了消息 Markdown 渲染的 XSS 风险、React Hooks/Lint 问题、旧 `middleware.ts` 约定的弃用提示，以及本地文件存储不适合多实例部署等问题。

## 项目工作台核心闭环

围绕"上传资料、选择文件、快捷任务、项目上下文聊天"完成了第一轮 MVP 接线：

- 项目页支持选择文件，并把 `projectId`、`selectedFileIds`、`mode` 传入聊天请求。
- 快捷任务可填入输入框，用户可以继续编辑后再发送。
- 项目历史对话可在项目侧栏中切换和重新载入。
- `/api/chat` 增加项目、文件和对话归属校验。
- 项目资料上下文设置严格长度上限。
- 未配置 API Key 时不再提前创建空对话。
- 文件选择补充复选语义和键盘可访问性。
- 普通聊天请求保持兼容。

随后使用一次性测试账户和一条短文本资料进行了真实 DeepSeek Flash 请求，确认 SSE 流式响应正常、选中文件内容进入模型上下文、对话和回答刷新后仍可重新载入。

## MiniMax 识图、PDF 解析与成果库

实施了 MiniMax 资料流水线和 Artifact 成果系统：

- 使用 `@anthropic-ai/sdk` 统一调用 DeepSeek 和 MiniMax 的 Anthropic 兼容接口。
- API Key 按 `deepseek`、`minimax` provider 隔离管理。
- 图片支持手动调用 MiniMax M3 OCR。
- PDF 先尝试 PDF.js 文本提取，扫描型 PDF 再降级为逐页 OCR。
- OCR 结果支持查看、编辑、重试和 DeepSeek 知识增强。
- RAG 统一为"选中文件优先、关键词检索补充、未来向量检索兜底"的降级路径。
- 新增 Artifact 模型、CRUD API 和项目成果库，助手回答可保存为成果。
- Markdown 作为成果唯一正文源，可导出 Markdown、DOCX 和 PDF。
- Markdown 渲染切换为 `react-markdown + remark-gfm`，移除了原有危险 HTML 注入路径。

## 侧边栏与项目界面调整

- 聊天和项目入口统一移动到主侧边栏，支持展开、收起。
- 进入具体项目后，主侧边栏自动收为 64px 图标栏。
- 项目功能侧边栏顶部新增"项目空间"和"新建项目"入口。
- 移动端项目侧边栏改为遮罩抽屉。
- 主导航、项目资料栏和成果库统一为 300ms 平滑位移动画，支持 `prefers-reduced-motion`。

## 项目与 GitHub 重命名

项目品牌从 `Light AI Chat` / `light-ai-chat` 统一为 `LumenLab`：

- npm 包名、页面标题、登录注册页、导航文案和文档完成改名。
- GitHub 仓库从 `mkynyd/course-lab` 改名为 `mkynyd/LumenLab`。
- 本地文件夹名仍保留为 `light-ai-chat`。

## 四层缓存架构

- 客户端缓存：TanStack Query，统一 Query Key、typed hooks、精确失效和乐观更新。
- 服务端请求去重：React `cache()` 数据访问层，仅在单次请求内去重。
- 应用缓存：Redis 用于滑动窗口限流、Artifact 导出缓存和指标计数。
- 外部 API 缓存：记录 DeepSeek/MiniMax 缓存 token，提供默认关闭的实验骨架。
- Redis 不可用时自动降级到有界内存实现。
- Settings 增加缓存命中率指标。
- 长对话使用 TanStack Virtual，流式中的最后一条消息保持直接渲染。

## Alpha 注册与集中 API Key

为小规模 Alpha 测试设计并实现了注册码与集中密钥体系，同时涉及主业务和独立管理端。

主业务 `LumenLab` 完成：

- 注册改为"邮箱 + 密码 + 必填注册码"。
- 注册码只保存 HMAC 摘要，不保存可兑换明文。
- 使用 Serializable 事务原子校验有效期、状态和兑换次数。
- 用户绑定管理员发布的 Credential Profile。
- DeepSeek/MiniMax Key 改为服务端中央解析，用户不再自行填写 API Key。
- 新增管理端发布快照同步 API。
- 同步协议使用 RSA-OAEP、AES-256-GCM、HMAC、时间戳和 nonce 防重放。
- 支持停止新兑换、停用密钥组和显式撤销已注册用户。
- `middleware.ts` 迁移为 Next.js 16 的 `proxy.ts`。

独立管理端 `course-ai-regadmin` 完成：

- 独立 Git 仓库、数据库和加密密钥。
- 单管理员密码与 TOTP 双因素登录。
- 密钥组、注册码、发布记录和审计日志管理。
- API Key 保存后只显示掩码，注册码明文只在创建时显示一次。
- 发布前校验 DeepSeek 和 MiniMax 凭据。
- 显式向主业务发布加密版本快照。

## 生产部署

于 2026-06-22 完成两个项目的生产环境部署：

**服务器**：OpenCloudOS 9.4, 2 核, 1.7GB RAM, 50GB SSD

**部署架构**：

```
用户 → Nginx (HTTPS, 宝塔管理)
     → 127.0.0.1:3000 (LumenLab, systemd)
     → 127.0.0.1:3001 (course-ai-regadmin, systemd)
     → PostgreSQL 16 + pgvector 0.8 (本地环回)
     → Redis 7 (本地环回)
     → 七牛云 Kodo (文件存储, bucket: LumenLab)
```

**关键配置**：

- 两个项目均使用 Next.js standalone 输出，通过 systemd 管理
- Nginx 反向代理，SSE 流式关闭缓冲，上传限制 220m
- TLS 证书由 Let's Encrypt 签发，宝塔自动续期
- 数据库和 Redis 仅绑定 127.0.0.1，不对外暴露
- 注册码同步密钥和 RSA 密钥对两端一致
- Redis 连接配置修复：`enableOfflineQueue: true`, `connectTimeout: 2000`

**域名**：

- `lab.mkynstudio.top` — 主业务项目
- `regadmin.mkynstudio.top` — 注册码管理后台

**数据库状态**：

- `course_ai_lab`：19 个表，9 个 migration 已应用，业务数据为零（干净启动）
- `course_ai_regadmin`：9 个表，1 个 migration 已应用，1 个管理员账号

**管理员凭据**保存在 `../ADMIN_CREDENTIALS.md`（已 gitignore，不提交）。

## 项目架构总结

### 产品定位

`LumenLab` 是面向大学计算机课程的 AI 实验工作台与资料整理系统。核心目标是让学生上传实验数据、代码、课件、试卷和笔记后，通过快捷任务直接生成可复制、可编辑、可保存的 Markdown 成果。

### 技术栈

| 层级 | 技术 |
|---|---|
| 前端框架 | Next.js 16.2 App Router、React 19、TypeScript、Tailwind CSS 4 |
| 认证 | Auth.js v5、Credentials Provider、JWT |
| 数据库 | PostgreSQL 16、pgvector 0.8、Prisma 7.8 |
| AI 调用 | Anthropic SDK，兼容 DeepSeek 与 MiniMax 接口 |
| 流式通信 | SSE，服务端 tee 分流持久化 |
| 文件处理 | PDF.js、MinerU Precision、MiniMax M3 OCR、@napi-rs/canvas |
| RAG | DocumentChunk 分块、关键词降级检索、pgvector 向量检索 |
| 缓存 | TanStack Query、React `cache()`、Redis + 内存降级 |
| 导出 | unified/remark AST、docx、Playwright/Chromium PDF、sharp |
| 存储 | 七牛云 Kodo 私有对象存储（生产），本地文件系统（开发降级） |
| 加密 | AES-256-GCM、bcrypt、RSA-OAEP、HMAC-SHA256 |
| 部署 | Next.js standalone、systemd、Nginx、宝塔 SSL 管理 |

### 核心数据流

```
用户登录
  → 创建项目或普通对话
  → 上传并解析资料
  → 选择文件或执行项目检索
  → Task Router 判定任务类型
  → Prompt 模板组装项目与资料上下文
  → DeepSeek SSE 流式生成
  → 前端实时展示正文、思考与用量
  → 消息异步持久化
  → 可保存为 Artifact
  → 导出 Markdown / DOCX / PDF
```

### 安全边界

- 所有用户资源按 `session.user.id` 隔离。
- 项目、文件、对话和成果关联 ID 均在服务端重新校验。
- 密码使用 bcrypt，API Key 使用 AES-256-GCM 加密存储。
- 上传文件限制类型与大小，不执行用户代码。
- 模型错误和 SSE 错误不返回密钥、环境变量或内部堆栈。
- 注册码同步使用 RSA-OAEP + AES-256-GCM + HMAC-SHA256 + nonce 防重放。

## 项目进度总结

### 已完成并上线

- 注册、登录、JWT 会话和路由保护。
- DeepSeek SSE 聊天与消息持久化。
- 项目、文件、项目对话和快捷任务闭环。
- 项目资料上下文传递与归属校验。
- 文本切块、关键词降级检索、pgvector 向量字段以及 qwen3-vl-embedding 1024 维融合向量生成与检索。
- MiniMax 图片 OCR 与 PDF 双模解析。
- Artifact 成果库及 Markdown、DOCX、PDF 导出。
- 安全 Markdown 渲染 (react-markdown)。
- 统一可收起侧边栏和移动端项目抽屉。
- 四层缓存、Redis 降级、缓存指标和长消息虚拟化。
- 项目和 GitHub 仓库统一命名为 `LumenLab`。
- Alpha 注册码注册与集中密钥管理。
- 主业务与管理端加密同步。
- 单管理员 TOTP 双因素管理端。
- 七牛云 Kodo 对象存储集成。
- 生产环境部署：systemd + Nginx + PostgreSQL 16 + Redis 7。
- README、产品说明、实现说明和仓库索引。

### 尚未完成

- 缓存实验开关默认关闭，需要收集真实基线后再启用。
- PDF 字体路径可能在无桌面环境的服务器上需要额外配置。
