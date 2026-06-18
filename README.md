<h1 align="center">course-ai-lab</h1>

<p align="center">
  <strong>面向大学生 CS 课程的 AI 实验工作台与资料复习系统</strong>
</p>

<p align="center">
  将通用 AI 对话与项目化资料管理相结合 — 上传课件/实验数据/代码，选择上下文进行对话，把有价值的回答保存为可导出的成果
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-pgvector?logo=postgresql" alt="PostgreSQL + pgvector" />
</p>


---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [使用指南](#使用指南)
- [部署](#部署)
- [贡献](#贡献)

---

## 项目简介

**course-ai-lab** 是一个面向大学计算机课程学生的 AI 学习平台。它将 AI 对话与项目化资料管理融为一体，帮助学生整理实验数据、复习课件、调试代码，并把有价值的 AI 回答保存为 Markdown/DOCX/PDF 成果。

### 目标用户

面向需要整理课程资料、实验数据、代码和复习材料的大学生与学习者。用户通常在桌面端持续使用，需要快速切换上下文并保持工作区专注。

---

## 核心特性

### 智能任务路由
上传文件或输入问题后，系统自动识别 16 种任务类型（实验报告生成、数据计算、图表绘制、代码调试、课件总结、试卷分析、速记生成……），无需手动切换模式。纯规则引擎，零 token 消耗。

### 项目化资料管理
- 创建项目（实验/复习/编程/通用），为每个项目配置独立的系统提示词和默认模型
- 上传文件（图片/PDF/文本），自动 OCR 解析和知识增强
- 选择项目文件作为对话上下文，AI 回答基于真实资料

### 降级 RAG 检索
三级检索策略：用户选中文件 → 关键词搜索（PostgreSQL ILIKE）→ 向量检索（pgvector，待接入 embedding）。无需外部 embedding 服务即可工作。

### 多模型流式对话
- 支持 DeepSeek V4 Pro / DeepSeek V4 Flash，Thinking 模式可选
- SSE 流式输出，Markdown 实时渲染
- 长对话虚拟化（TanStack Virtual），流畅滚动

### Artifact 成果库
- 对话中的优质回答可保存为 Artifact，支持 14 种成果类型
- 一键导出 Markdown / DOCX / PDF
- Markdown 为唯一源，AST 级转换保证格式一致

---

## 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | Next.js 16.2 (App Router, React 19, TypeScript 5) |
| **数据库** | PostgreSQL 16 + pgvector (Docker) |
| **ORM** | Prisma 7.8 |
| **AI SDK** | `@anthropic-ai/sdk` |
| **缓存** | Redis 7 + TanStack Query + React `cache()` |
| **认证** | NextAuth.js v5 (JWT, Credentials Provider) |
| **样式** | Tailwind CSS 4 |
| **虚拟化** | TanStack Virtual |
| **文件处理** | PDF.js + @napi-rs/canvas + fonteditor-core |
| **文档导出** | docx (DOCX) + pdfkit (PDF) + unified/remark (Markdown AST) |
| **加密** | AES-256-GCM (Node.js crypto) |
| **验证** | Zod 4 |
| **测试** | Vitest + Testing Library |
| **基础设施** | Docker Compose (PostgreSQL + Redis) |

---

## 快速开始

### 前提条件

- Node.js 20+
- Docker Desktop（用于 PostgreSQL + Redis）
- 由 `course-ai-regadmin` 发布的 Alpha 注册码与密钥组

### 1. 克隆仓库

```bash
git clone <repo-url>
cd course-ai-lab
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动基础设施

```bash
docker compose up -d
```

这会启动：

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL 16 + pgvector | `5432` | 主数据库 |
| Redis 7 | `6379` | 缓存与限流（可选，离线时自动降级） |

### 4. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填写必要变量：

```dotenv
# 数据库
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_workspace?schema=public"

# Redis（可选，离线时自动降级到内存）
REDIS_URL="redis://localhost:6379"

# 认证 — 生成命令: openssl rand -base64 32
AUTH_SECRET="your-generated-secret"

# API Key 加密密钥 — 生成命令: openssl rand -hex 32
ENCRYPTION_KEY="your-64-char-hex-string"

# Alpha 注册与内部同步
REGISTRATION_CODE_PEPPER="generate-with-openssl-rand-base64-48"
REGISTRATION_SYNC_SECRET="shared-with-course-ai-regadmin"
REGISTRATION_SYNC_PRIVATE_KEY_BASE64="base64-encoded-RSA-private-key-PEM"

# 应用
AUTH_URL="https://lab.mkynstudio.top"
NEXT_PUBLIC_APP_NAME="AI 实验工作台"
```

### 5. 初始化数据库

```bash
npx prisma migrate dev
```

### 6. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，使用邮箱、密码和已发布的 Alpha 注册码创建账户。供应商 Key 由测试管理员统一配置，不会发送到浏览器。

---

## 项目结构

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # 登录/注册
│   ├── (chat)/                   # 主应用（聊天/项目/设置）
│   └── api/                      # REST API
│       ├── chat/route.ts         # SSE 流式聊天（核心路由）
│       ├── internal/registration-sync/ # 管理工具内部发布端点
│       ├── files/[id]/parse/     # 文件解析（PDF.js + MiniMax OCR）
│       ├── files/[id]/enhance/   # 文件知识增强
│       └── artifacts/[id]/export/ # 成果导出（MD/DOCX/PDF）
│
├── lib/
│   ├── deepseek.ts               # DeepSeek API（Anthropic SDK 流式）
│   ├── ai/
│   │   ├── task-router.ts        # 关键词规则引擎（16 种任务类型）
│   │   └── prompts.ts            # Prompt 模板系统（5 套角色 Prompt）
│   ├── vision/minimax.ts         # MiniMax M3 视觉 OCR
│   ├── rag/vector-store.ts       # 降级 RAG（分块 + 关键词 + 向量）
│   ├── files/pdf-parser.ts       # PDF 双模解析引擎
│   ├── export/                   # Markdown → DOCX/PDF AST 级导出
│   ├── cache/                    # 缓存模块（实验配置/导出缓存/指标）
│   ├── hooks/                    # TanStack Query Hooks
│   └── data/                     # 服务端数据访问层（React cache()）
│
├── components/
│   ├── chat/                     # 聊天组件（输入/气泡/虚拟化/用量）
│   ├── project/                  # 项目组件（侧边栏/文件上传/列表）
│   ├── artifact/                 # 成果库组件
│   └── layout/                   # 布局组件（导航栏/侧边栏）
│
└── prisma/
    └── schema.prisma             # 数据模型定义（14 个模型）
```

> 完整文件树见 [`REPOSITORY_INDEX.md`](REPOSITORY_INDEX.md)

---

## 架构设计

### 核心数据流

```
用户输入 → task-router（规则引擎判定模式）
         → prompts（选择对应 Prompt 模板）
         → vector-store（RAG 检索项目资料）
         → deepseek.ts（Anthropic SDK 流式调用）
         → SSE Stream → 前端 useChat hook 实时渲染
         → Message 异步保存（tee 流写入 DB，含缓存量）
```

### 四层缓存

```
┌─ Layer 1: TanStack Query ──────────────── 30s stale, optimistic update
├─ Layer 2: React cache() ───────────────── per-request DB 查询去重
├─ Layer 3: Redis + 内存降级 ────────────── 限流/导出缓存/指标
└─ Layer 4: DeepSeek KV + MiniMax Prompt ── API 侧自动前缀缓存
```

### 安全模型

```
请求 → 中间件（JWT 验证）
     → 路由层（userId 归属校验）
     → 数据层（projectId/conversationId 关联校验）
     → 敏感数据（集中 API Key AES-256-GCM 加密，密码 bcrypt 哈希）
```

---

## 使用指南

### 创建项目

1. 点击侧边栏「新建项目」
2. 选择项目类型：实验 / 复习 / 编程 / 通用
3. （可选）为项目设置默认模型和系统提示词

### 上传资料

1. 进入项目，在侧边栏上传文件
2. 支持格式：PNG、JPEG、WebP、PDF、TXT、MD、JSON 等
3. 图片和扫描 PDF 自动调用 MiniMax OCR 转为 Markdown
4. 文字型 PDF 秒级文本提取
5. （可选）对 OCR 结果进行 DeepSeek 知识增强

### 开始对话

1. 在项目聊天区输入问题
2. 可以在快捷任务栏选择任务类型（自动识别也可）
3. 勾选「选择文件」以指定对话上下文
4. 可选启用 Thinking 模式（DeepSeek V4 Pro 深度推理）
5. AI 回答基于项目资料，所有不确定内容标注"[需补充]"

### 保存成果

1. 对话中满意的回答可保存为 Artifact
2. 选择成果类型（实验报告/数据计算/课件总结/代码解释……）
3. 成果库中可随时导出为 Markdown、DOCX 或 PDF

### 查看缓存指标

在「设置」页面的缓存指标区域可以查看：
- 近 7 天总体命中率
- 每日 token 命中量柱状图
- DeepSeek / MiniMax 分 Provider 命中率对比
- Artifact 导出缓存命中率

---

## 部署

### Docker 部署

确保服务器上有 Docker 和 Docker Compose，配置好 `.env` 后：

```bash
# 构建
npm run build

# 启动（需要先启动 PostgreSQL + Redis）
docker compose up -d
npm run start
```

### 安全注意事项

- 生产环境务必修改 `AUTH_SECRET` 和 `ENCRYPTION_KEY` 为强随机值
- 建议在反向代理（Nginx/Caddy）层配置 HTTPS
- Redis 建议配置密码认证
- 定期备份 PostgreSQL 数据库

---

## 贡献

欢迎提交 Issue 和 Pull Request。

### 开发约定

- 使用 `npm test` 运行测试
- 使用 `npm run lint` 检查代码风格
- 新增模块请遵循现有代码组织模式
- API Key 等敏感信息禁止硬编码

---

## License

[MIT](LICENSE)

---

<p align="center">
  Built with Next.js 16 · Anthropic SDK · PostgreSQL/pgvector · Redis
</p>
