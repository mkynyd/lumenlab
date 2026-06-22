# LumenLab

面向大学计算机课程的 AI 实验工作台，将通用 AI 对话与项目化资料管理结合。学生上传课件、实验数据、代码和笔记后，通过智能任务路由获得基于真实资料的 AI 回答，并将有价值的回答保存为可导出的成果。

![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-16-pgvector?logo=postgresql)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [部署](#部署)
- [贡献](#贡献)

---

## 项目简介

LumenLab 是一个面向大学生与学习者的 AI 学习平台。它围绕"项目"组织课程资料，通过智能任务路由自动识别用户意图（实验报告、代码调试、课件总结等 16 种任务类型），让 AI 基于真实上传资料进行对话，并将有长期价值的回答保存为 Markdown、DOCX 或 PDF 成果。

### 目标用户

需要整理课程资料、实验数据、代码和复习材料的大学生。用户通常在桌面端持续使用，需要快速切换项目上下文并保持工作区专注。

---

## 核心特性

### 智能任务路由

上传文件或输入问题后，系统通过关键词规则引擎自动判定 16 种任务类型，无需手动切换模式。零 token 消耗，响应即时。

### 项目化资料管理

- 按实验、复习、编程、通用四种类型创建项目，每个项目可配置独立的系统提示词和默认模型
- 上传图片、PDF、文本文件，自动 OCR 解析和知识增强
- 在对话中勾选项目文件作为上下文，AI 回答基于真实资料

### 多模型流式对话

- 支持 DeepSeek V4 Pro / DeepSeek V4 Flash，Thinking 深度推理模式可选
- SSE 流式输出，Markdown 实时渲染，长对话虚拟化滚动
- 集中式 API Key 管理：用户无需自行申请 Key，由管理员通过注册码体系统一配置

### PDF 文档转换

- 使用 MinerU 将 PDF 逐页解析为包含公式、表格和图片的 Markdown
- 在线预览完整渲染结果，下载含 Markdown、图片目录、样式 PDF 和 DOCX 的 ZIP 包
- 支持将转换结果保存为项目资料，图片复制为项目独立资源

### 降级 RAG 检索

三级检索策略按优先级：用户选中文件、关键词全文搜索、pgvector 向量检索。可在无外部 embedding 服务的情况下正常工作，向量检索接入后自动提升精度。

### Artifact 成果库

- 对话中的优质回答可保存为 Artifact，支持 14 种成果类型
- 一键导出 Markdown、DOCX、PDF，以 Markdown 为唯一源，AST 级转换保证格式一致
- 导出结果通过 Redis 缓存，重复下载即时返回

### 注册码与集中认证

- 用户注册需提供邮箱、密码和有效注册码
- 注册码由独立管理端 course-ai-regadmin 生成和发布
- API Key 集中加密存储，用户无法查看明文
- 同步协议使用 RSA-OAEP + AES-256-GCM + HMAC 防篡改和重放

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16.2 (App Router, Turbopack, Standalone 输出) |
| 语言 | TypeScript 5, React 19 |
| 数据库 | PostgreSQL 16 + pgvector 0.8 |
| ORM | Prisma 7.8 |
| AI 调用 | Anthropic SDK (兼容 DeepSeek / MiniMax Anthropic 接口) |
| 缓存 | Redis 7 + TanStack Query + React `cache()` |
| 认证 | NextAuth.js v5 (Credentials Provider, JWT) |
| 样式 | Tailwind CSS 4 |
| 虚拟化 | TanStack Virtual |
| 文件解析 | MinerU Precision, PDF.js, MiniMax M3 OCR, @napi-rs/canvas |
| 文档导出 | docx, sharp, Playwright/Chromium, pdfkit, unified/remark |
| 存储 | 七牛云 Kodo 私有对象存储 (生产), 本地文件系统 (开发降级) |
| 加密 | AES-256-GCM, bcrypt, RSA-OAEP, HMAC-SHA256 |
| 验证 | Zod 4 |
| 测试 | Vitest, Testing Library |

---

## 项目结构

```
src/
├── app/                              # Next.js App Router
│   ├── (auth)/                       # 登录、注册页面
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (chat)/                       # 主应用壳层
│   │   ├── layout.tsx                # 全局侧边栏布局
│   │   ├── chat/page.tsx             # 普通聊天
│   │   ├── chat/[id]/page.tsx        # 历史对话
│   │   ├── projects/page.tsx         # 项目列表
│   │   ├── projects/new/page.tsx     # 新建项目
│   │   ├── projects/[id]/page.tsx    # 项目工作台
│   │   ├── settings/page.tsx         # 用户设置
│   │   └── tools/page.tsx            # 文档工具
│   └── api/                          # REST API
│       ├── chat/route.ts             # SSE 流式聊天（核心路由）
│       ├── auth/[...nextauth]/       # NextAuth 认证路由
│       ├── auth/register/            # 注册码注册
│       ├── projects/                 # 项目 CRUD
│       ├── conversations/            # 对话管理
│       ├── files/                    # 文件上传、解析、下载、增强
│       ├── artifacts/                # 成果库 CRUD 与导出
│       ├── tools/                    # PDF 转换、图片导出
│       ├── internal/registration-sync/ # 管理端同步端点
│       ├── user/switch-code/         # 用户切换注册码
│       ├── health/                   # 健康检查
│       └── metrics/cache/            # 缓存指标
├── lib/
│   ├── deepseek.ts                   # DeepSeek API 客户端 (Anthropic SDK 流式)
│   ├── ai/
│   │   ├── task-router.ts            # 16 种任务类型规则引擎
│   │   └── prompts.ts                # Prompt 模板系统
│   ├── vision/minimax.ts             # MiniMax M3 视觉 OCR
│   ├── rag/
│   │   ├── vector-store.ts           # 降级 RAG（分块 + 关键词 + 向量）
│   │   ├── embedding.ts              # 百炼 text-embedding-v4
│   │   ├── project-index.ts          # 项目综合索引构建
│   │   └── retrieve-context.ts       # 上下文检索入口
│   ├── files/
│   │   └── pdf-parser.ts             # PDF 双模解析引擎
│   ├── export/                       # Markdown 导出 (DOCX, PDF, ZIP)
│   ├── parse/                        # MinerU 文本解析
│   ├── storage/object-storage.ts     # 七牛云 Kodo 对象存储
│   ├── registration-code.ts          # 注册码摘要与校验
│   ├── registration-sync.ts          # 同步载荷校验
│   ├── registration-sync-crypto.ts   # 同步加密 (RSA + AES + HMAC)
│   ├── provider-access.ts            # 集中式 API Key 解析
│   ├── crypto.ts                     # AES-256-GCM 加解密
│   ├── cache/                        # 缓存模块 (导出缓存、指标、实验)
│   ├── redis.ts                      # Redis 连接与健康检查
│   ├── db.ts                         # Prisma 客户端
│   ├── auth.ts / auth.config.ts      # NextAuth 配置
│   ├── hooks/                        # TanStack Query Hooks
│   ├── data/                         # 服务端数据访问层 (React cache)
│   └── validators.ts                 # Zod 校验
├── components/
│   ├── chat/                         # 聊天组件 (输入框、消息气泡、虚拟列表、用量)
│   ├── project/                      # 项目组件 (侧边栏、文件上传、快捷任务)
│   ├── artifact/                     # 成果库组件
│   ├── settings/                     # 设置面板 (API Key、缓存指标)
│   └── layout/                       # 布局组件 (导航栏、侧边栏)
└── prisma/
    ├── schema.prisma                 # 数据模型 (19 个模型)
    └── migrations/                   # 数据库迁移 (9 个)
```

---

## 架构设计

### 核心数据流

```
用户输入 → task-router（规则引擎判定任务类型）
         → prompts（选择对应 Prompt 模板）
         → vector-store（RAG 检索项目资料上下文）
         → deepseek.ts（Anthropic SDK 流式调用 DeepSeek）
         → SSE Stream → 前端实时渲染 Markdown
         → Message 异步持久化（tee 流写入 DB，记录缓存 token）
         → 可选保存为 Artifact → 导出 MD/DOCX/PDF
```

### 四层缓存

| 层 | 实现 | 策略 |
|---|------|------|
| 客户端状态 | TanStack Query | 30s stale, 5min GC, 精确失效 |
| 请求去重 | React `cache()` 数据层 | 单次 request 内 DB 查询去重 |
| 应用缓存 | Redis + 内存降级 | 滑动窗口限流, 导出缓存 1h TTL |
| 外部 API | DeepSeek KV + MiniMax Prompt Cache | 实验开关默认关闭 |

### 安全模型

```
请求 → NextAuth JWT 中间件 (proxy.ts)
     → 路由层 userId 归属校验
     → 数据层 projectId / conversationId 关联校验
     → 密码 bcrypt 哈希, API Key AES-256-GCM 加密
     → 同步协议: RSA-OAEP + AES-256-GCM + HMAC + nonce 防重放
```

---

## 快速开始

### 前提条件

- Node.js 20+
- PostgreSQL 16 + pgvector
- Redis 7
- course-ai-regadmin 管理端发布的注册码与密钥组

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

需要配置的核心变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串（可选，离线时降级至内存） |
| `AUTH_SECRET` | 生成命令: `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | 64 位 hex, 生成命令: `openssl rand -hex 32` |
| `REGISTRATION_CODE_PEPPER` | 注册码加盐, 与 regadmin 的 FINGERPRINT_SECRET 独立 |
| `REGISTRATION_SYNC_SECRET` | 与 course-ai-regadmin 共享的同步密钥 |
| `REGISTRATION_SYNC_PRIVATE_KEY_BASE64` | RSA 私钥 (PEM base64) |
| `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` | 七牛云 Kodo 密钥（生产必填） |
| `QINIU_BUCKET` | Kodo 空间名 |
| `AUTH_URL` | 生产环境: `https://lab.mkynstudio.top` |

### 3. 初始化数据库

```bash
npx prisma migrate deploy
```

### 4. 启动开发服务器

```bash
npm run dev
```

打开 `http://localhost:3000`，使用邮箱、密码和有效注册码创建账户。

---

## 使用指南

### 创建项目

1. 点击侧边栏「新建项目」
2. 选择项目类型（实验、复习、编程、通用）
3. 可选设置默认模型和系统提示词

### 上传资料

1. 进入项目，在侧边栏上传文件（PNG、JPEG、WebP、PDF、TXT、MD 等）
2. 图片自动 OCR 转为文字；PDF 自动文本提取或逐页 OCR
3. 可选对 OCR 结果进行知识增强

### 开始对话

1. 在项目聊天区输入问题，或选择快捷任务
2. 勾选「选择文件」指定对话上下文
3. 可选启用 Thinking 模式获得深度推理
4. AI 回答基于项目资料，不确定内容标注 `[需补充]`

### 保存成果

1. 满意的回答可保存为 Artifact（14 种成果类型）
2. 成果库中可导出为 Markdown、DOCX 或 PDF

### 转换 PDF 文档

1. 侧边栏进入「文档」，上传 PDF
2. 等待 MinerU 逐页解析，在线预览公式、表格和图片
3. 下载完整 ZIP 包，或保存到项目作为资料

---

## 部署

### 生产环境

项目已在 `lab.mkynstudio.top` 生产运行。架构如下：

```
用户 → Nginx (HTTPS, 宝塔管理)
     → 127.0.0.1:3000 (Next.js standalone, systemd)
     → PostgreSQL 16 + Redis 7 (本地环回)
     → 七牛云 Kodo (文件存储)
     → course-ai-regadmin (注册码同步, regadmin.mkynstudio.top)
```

### 构建

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
```

Next.js 配置 `output: "standalone"`，构建产物自包含 Node.js 运行时所需的所有依赖。通过 systemd 管理进程，Nginx 反向代理。

### Nginx 配置要点

- 反向代理到 `127.0.0.1:3000`
- SSE 流式输出需关闭代理缓冲：`proxy_buffering off`
- 上传限制匹配 `experimental.proxyClientMaxBodySize`：`client_max_body_size 220m`
- 静态资源 `/_next/static` 由 Nginx 直接提供

### 数据库迁移

```bash
# 检查待应用迁移
npx prisma migrate status

# 应用迁移（生产环境）
npx prisma migrate deploy
```

---

## 贡献

### 开发约定

- `npm test` 运行测试 (Vitest)
- `npm run lint` 代码风格检查
- 遵循项目现有的代码组织模式
- API Key 等敏感信息禁止硬编码

### 相关项目

- [course-ai-regadmin](https://github.com/mkynyd/course-ai-regadmin) — 注册码管理后台，负责注册码生成、密钥组管理和发布同步

---

[MIT](LICENSE)
