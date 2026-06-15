# 仓库索引 — course-ai-lab

> 面向大学生 CS 课程的 AI 实验工作台与资料复习系统
>
> 技术栈：Next.js 16 + TypeScript + PostgreSQL (pgvector) + Anthropic SDK
>
> 最后更新：2026-06-15

---

## 文件树总览

```
light-ai-chat/
├── AGENTS.md                          # Agent 约束规则
├── CLAUDE.md                          # Claude Code 入口（→ AGENTS.md）
├── IMPLEMENTATION.md                  # 缓存架构实现说明
├── PRODUCT.md                         # 产品设计文档
├── README.md                          # 项目说明
├── REPOSITORY_INDEX.md                # 本文件 — 仓库索引
├── docker-compose.yml                 # PostgreSQL + Redis 容器编排
├── eslint.config.mjs                  # ESLint 配置
├── next.config.ts                     # Next.js 配置（安全头、Turbopack）
├── package.json                       # 依赖与脚本
├── package-lock.json
├── postcss.config.mjs                 # PostCSS 配置
├── prisma.config.ts                   # Prisma 配置
├── tsconfig.json                      # TypeScript 配置
├── vitest.config.ts                   # Vitest 测试配置
├── .env                               # 环境变量（敏感，不提交）
├── .env.example                       # 环境变量模板
├── .gitignore
├── dev.db                             # 旧 SQLite 数据库（已废弃）
│
├── docs/                              # 📁 文档
│   ├── MiniMax/                       #   MiniMax API 文档（18 个文件）
│   ├── DeepSeek/                      #   DeepSeek API 文档（12 个文件）
│   ├── superpowers/plans/             #   架构设计计划
│   ├── artifact-export.md             #   Artifact 导出说明
│   ├── cache-architecture-codex-prompt.md  # 缓存架构设计提示词
│   ├── database-postgresql-pgvector.md     # 数据库运维指南
│   └── project-innovations.md         #   项目创新点汇总（15 项）
│
├── prisma/                            # 📁 数据库
│   ├── schema.prisma                  #   Prisma schema（7 个模型）
│   └── migrations/                    #   数据库迁移文件
│       ├── 20260613075534_migrate_to_postgresql_pgvector/
│       └── 20260613143000_add_minimax_pipeline_and_artifacts/
│
├── public/                            # 📁 静态资源
│   └── *.svg                          #   图标
│
├── uploads/                           # 📁 用户上传文件存储
│
└── src/                               # 📁 源代码
    ├── middleware.ts                  #   NextAuth 路由保护中间件
    ├── types/
    │   └── next-auth.d.ts             #   NextAuth 类型扩展
    │
    ├── generated/prisma/              #   Prisma 生成的客户端代码
    │   ├── client.ts
    │   ├── browser.ts
    │   ├── models.ts
    │   ├── enums.ts
    │   └── ...
    │
    ├── app/                           #   Next.js App Router 页面与 API
    │   ├── layout.tsx                 #   根布局
    │   ├── page.tsx                   #   首页（重定向）
    │   ├── globals.css                #   全局样式
    │   ├── favicon.ico
    │   │
    │   ├── (auth)/                    #   认证页面组
    │   │   ├── layout.tsx
    │   │   ├── login/page.tsx
    │   │   └── register/page.tsx
    │   │
    │   ├── (chat)/                    #   主应用页面组（需登录）
    │   │   ├── layout.tsx             #    应用壳层（Navbar + Sidebar + 内容区）
    │   │   ├── chat/
    │   │   │   ├── page.tsx           #    聊天列表页
    │   │   │   └── [id]/page.tsx      #    单个对话页
    │   │   ├── projects/
    │   │   │   ├── page.tsx           #    项目列表页
    │   │   │   ├── new/page.tsx       #    新建项目页
    │   │   │   └── [id]/page.tsx      #    项目详情页（聊天 + 文件 + 成果）
    │   │   └── settings/page.tsx      #    设置页（API Key + 缓存指标）
    │   │
    │   └── api/                       #   API 路由
    │       ├── auth/
    │       │   ├── [...nextauth]/route.ts  # NextAuth 处理器
    │       │   └── register/route.ts       # 注册 API
    │       ├── chat/route.ts          #   **核心** — SSE 流式聊天 API
    │       ├── conversations/
    │       │   ├── route.ts           #   对话列表 CRUD
    │       │   └── [id]/route.ts      #   单个对话 CRUD
    │       ├── projects/
    │       │   ├── route.ts           #   项目列表 CRUD
    │       │   └── [id]/
    │       │       ├── route.ts       #   单个项目 CRUD
    │       │       ├── files/route.ts #   项目文件 API
    │       │       └── artifacts/route.ts  # 项目成果 API
    │       ├── files/
    │       │   └── [id]/
    │       │       ├── route.ts       #   文件 CRUD
    │       │       ├── parse/route.ts #   文件解析（PDF.js + MiniMax OCR）
    │       │       └── enhance/route.ts    # 文件增强（DeepSeek 知识增强）
    │       ├── artifacts/
    │       │   └── [id]/
    │       │       ├── route.ts       #   成果 CRUD
    │       │       └── export/route.ts     # 成果导出（MD/DOCX/PDF）
    │       ├── keys/route.ts          #   API Key CRUD
    │       └── metrics/cache/route.ts #   缓存命中率指标 API
    │
    ├── components/                    #   React 组件
    │   ├── layout/
    │   │   ├── navbar.tsx             #   顶部导航栏
    │   │   └── sidebar.tsx            #   侧边栏（对话 + 项目列表）
    │   ├── chat/
    │   │   ├── chat-area.tsx          #   聊天区域容器
    │   │   ├── chat-input.tsx         #   消息输入框
    │   │   ├── chat-input.test.tsx
    │   │   ├── message-bubble.tsx     #   消息气泡（Markdown 渲染）
    │   │   ├── model-selector.tsx     #   模型选择器
    │   │   ├── quick-task-bar.tsx     #   快捷任务类型选择
    │   │   ├── quick-task-bar.test.tsx
    │   │   ├── token-usage-bar.tsx    #   Token 用量展示
    │   │   ├── cost-display.tsx       #   费用展示
    │   │   ├── context-ring.tsx       #   上下文状态环
    │   │   ├── virtual-message-list.tsx    # 虚拟化消息列表
    │   │   └── virtual-message-list.test.ts
    │   ├── project/
    │   │   ├── project-sidebar.tsx    #   项目侧边栏
    │   │   ├── file-upload.tsx        #   文件上传组件
    │   │   ├── file-list.tsx          #   文件列表
    │   │   ├── file-list.test.tsx
    │   │   └── file-content-dialog.tsx     # 文件内容对话框
    │   ├── artifact/
    │   │   └── artifact-library.tsx   #   成果库组件
    │   ├── providers/
    │   │   └── query-provider.tsx     #   TanStack Query Provider
    │   └── ui/                        #   通用 UI 组件
    │       ├── button.tsx
    │       ├── input.tsx
    │       ├── switch.tsx
    │       ├── progress.tsx
    │       ├── progress-ring.tsx
    │       ├── theme-provider.tsx
    │       └── theme-toggle.tsx
    │
    ├── lib/                           #   核心业务逻辑库
    │   ├── auth.ts                    #   NextAuth 配置（Credentials Provider）
    │   ├── auth.config.ts             #   Auth 回调与路由守卫配置
    │   ├── db.ts                      #   Prisma Client 单例（PostgreSQL）
    │   ├── redis.ts                   #   Redis 连接管理（惰性连接）
    │   ├── crypto.ts                  #   AES-256-GCM 加密/解密
    │   ├── deepseek.ts                #   **核心** — DeepSeek API（Anthropic SDK 流式）
    │   ├── deepseek.test.ts
    │   ├── sse-client.ts              #   前端 SSE 流解析器
    │   ├── chat-request.ts            #   聊天请求体构建
    │   ├── chat-request.test.ts
    │   ├── validators.ts              #   Zod 验证 schema
    │   ├── validators.test.ts
    │   ├── query-keys.ts              #   TanStack Query Key 工厂
    │   ├── query-keys.test.ts
    │   ├── utils.ts                   #   通用工具函数
    │   │
    │   ├── ai/                        #   AI 策略模块
    │   │   ├── task-router.ts         #   **核心** — 关键词规则引擎路由（16 种任务）
    │   │   └── prompts.ts             #   **核心** — Prompt 模板系统（5 套角色 prompt）
    │   │
    │   ├── vision/
    │   │   └── minimax.ts             #   **核心** — MiniMax M3 视觉 OCR（Anthropic SDK）
    │   │
    │   ├── rag/
    │   │   ├── vector-store.ts        #   **核心** — 降级 RAG 检索（分块 + 关键词 + 向量）
    │   │   └── retrieve-context.test.ts
    │   │
    │   ├── files/
    │   │   ├── pdf-parser.ts          #   **核心** — PDF 双模解析（文字/扫描分流）
    │   │   └── pdf-parser.test.ts
    │   │
    │   ├── export/                    #   导出模块
    │   │   ├── markdown-ast.ts        #   Markdown → MDAST 解析
    │   │   ├── markdown-to-docx.ts    #   MDAST → DOCX（AST 级转换）
    │   │   ├── markdown-to-pdf.ts     #   MDAST → PDF（pdfkit + Noto Sans SC）
    │   │   ├── filename.ts            #   文件名生成
    │   │   ├── filename.test.ts
    │   │   └── exporters.test.ts
    │   │
    │   ├── cache/                     #   缓存模块
    │   │   ├── experiment-config.ts   #   实验策略配置开关
    │   │   ├── experiment-config.test.ts
    │   │   ├── export-cache.ts        #   Artifact 导出缓存（Redis）
    │   │   ├── export-cache.test.ts
    │   │   ├── api-cache-metrics.ts   #   缓存指标采集与聚合
    │   │   ├── api-cache-metrics.test.ts
    │   │   ├── prompt-reorder.ts      #   Prompt 重排策略（实验性）
    │   │   └── minimax-active-cache.ts     # MiniMax Active Cache（实验性）
    │   │
    │   ├── data/                      #   服务端数据访问层（React cache() 去重）
    │   │   ├── conversations.ts
    │   │   ├── projects.ts
    │   │   ├── messages.ts
    │   │   └── api-keys.ts
    │   │
    │   ├── hooks/                     #   客户端数据 Hooks（TanStack Query）
    │   │   ├── use-chat.ts            #   聊天状态与流式消息管理
    │   │   ├── use-conversations.ts
    │   │   ├── use-projects.ts
    │   │   ├── use-project-files.ts
    │   │   ├── use-artifacts.ts
    │   │   ├── use-api-keys.ts
    │   │   └── use-cache-metrics.ts
    │   │
    │   ├── api/                       #   API 客户端
    │   │   ├── types.ts
    │   │   ├── client.ts
    │   │   └── client.test.ts
    │   │
    │   └── rate-limit.ts              #   速率限制（Redis 滑动窗口 + 内存降级）
    │       └── rate-limit.test.ts
    │
    └── test/
        └── setup.ts                   #   Vitest 测试配置
```

---

## 核心架构

### 数据模型（7 个表）

| 模型 | 说明 | 关键字段 |
|------|------|---------|
| `User` | 用户账户 | id, email, passwordHash, name |
| `ApiKey` | API Key 加密存储 | userId, provider, encryptedKey (AES-256-GCM), keyPrefix |
| `Conversation` | 对话记录 | userId, projectId, title, model |
| `Message` | 消息记录 | conversationId, role, content, reasoningContent, tokenCount, cacheHitTokens, cacheMissTokens |
| `Project` | 项目空间 | userId, name, description, type, defaultModel, systemPrompt |
| `FileAsset` | 上传文件 | userId, projectId, filename, textContent, enhancedContent, status |
| `DocumentChunk` | 文档块（pgvector） | userId, projectId, fileAssetId, content, embedding (vector(1536)) |
| `Artifact` | 成果 | userId, projectId, conversationId, title, type, format, content |

### 四层缓存架构

| 层 | 实现 | 说明 |
|----|------|------|
| Client State | TanStack Query | 30s stale, 5min GC, optimistic update, mutation 精确失效 |
| Server Request | React `cache()` | 单次 Server Component render 内去重 Prisma 查询 |
| Application | Redis + 内存降级 | 滑动窗口限流、导出缓存 1h TTL、指标计数 |
| External API | DeepSeek KV Cache + MiniMax Prompt Cache | 自动前缀缓存，零配置，用量透明展示 |

### 核心数据流

```
用户输入 → task-router（规则引擎判定模式）
         → prompts（选择对应 Prompt 模板）
         → vector-store（RAG 检索项目资料）
         → deepseek.ts（Anthropic SDK 流式调用 DeepSeek）
         → SSE Stream → 前端 useChat hook 实时渲染
         → Message 保存（异步 tee 流写入 DB，含缓存命中量）
```

---

## 关键技术点

### 1. 单 SDK 双供应商
使用 `@anthropic-ai/sdk` 同时驱动 DeepSeek 和 MiniMax：
- **DeepSeek** (`src/lib/deepseek.ts`): `baseURL: api.deepseek.com/anthropic`, 模型名映射（`deepseek-v4-pro` → `claude-opus-4-8`）
- **MiniMax** (`src/lib/vision/minimax.ts`): `baseURL: api.minimaxi.com/anthropic`, 原生 `MiniMax-M3` 模型

### 2. 关键词规则引擎路由
`src/lib/ai/task-router.ts` — 零 token 消耗、零延迟，三组关键词词典（实验 30+ 词、复习 20+ 词、编程 20+ 词），16 种任务类型自动判定。

### 3. Prompt 模板系统
`src/lib/ai/prompts.ts` — 5 套教学法驱动的角色 Prompt 集中管理（全局系统、实验导师、复习导师、代码导师、视觉转录）。

### 4. 文件处理双模引擎
`src/lib/files/pdf-parser.ts` + `src/app/api/files/[id]/parse/route.ts`:
- 文字型 PDF → PDF.js 秒级提取
- 扫描型 PDF → 渲染为图片 → MiniMax M3 OCR
- 智能分流：文本 >500 字 + 有效字符 ≥70% → 直接提取，否则降级 OCR
- 后续可选 DeepSeek 知识增强（`enhance` API）

### 5. 降级 RAG 检索
`src/lib/rag/vector-store.ts` — 三级检索：用户选中文件 > 关键词搜索（ILIKE）> 向量检索（pgvector，待接入 embedding）

### 6. Artifact 成果库 + 三种导出
`src/lib/export/` — Markdown 为唯一真相源 → AST 级转换为 DOCX/PDF（无 Chromium 依赖）

### 7. 安全设计
- API Key: AES-256-GCM 加密存储 (`src/lib/crypto.ts`)
- 密码: bcrypt 哈希
- Session: NextAuth JWT 策略
- 全路由归属校验（userId + projectId + conversationId 链路）
- 安全响应头：X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy

### 8. Redis 故障自动降级
`src/lib/rate-limit.ts` — Redis 滑动窗口（Lua 原子操作），失败后 30 秒熔断 + 有界内存窗口降级。

---

## 开发命令

```bash
# 安装依赖
npm install

# 启动基础设施
docker compose up -d

# 数据库迁移
npx prisma migrate dev

# 启动开发服务器
npm run dev

# 运行测试
npm test

# 代码检查
npm run lint
```

## 环境变量

参考 `.env.example`：

| 变量 | 说明 | 必需 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | 是 |
| `REDIS_URL` | Redis 连接字符串 | 否（降级到内存） |
| `AUTH_SECRET` | NextAuth JWT 签名密钥 | 是 |
| `ENCRYPTION_KEY` | AES-256-GCM 加密密钥（64 hex） | 是 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | 是 |
| `AUTH_URL` | 应用 URL | 是 |
| `NEXT_PUBLIC_APP_NAME` | 应用名称 | 否 |
| `CACHE_EXPERIMENT_*` | 缓存实验开关（默认关闭） | 否 |
