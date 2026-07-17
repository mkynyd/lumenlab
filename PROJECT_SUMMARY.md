# LumenLab 项目摘要

> 更新日期：2026-07-17
> 仓库：`mkynyd/lumenlab`
> 当前主线：`main`
> 生产地址：[lab.mkynstudio.top](https://lab.mkynstudio.top)
> 在线文档：[lab.mkynstudio.top/docs](https://lab.mkynstudio.top/docs)

## 产品定位

LumenLab 是面向大学生与通用学习者的项目化 AI 工作台。用户可以围绕项目管理课程资料、代码、实验数据和笔记，通过多模型对话、RAG、Skill Router 与受控 Agent 完成学习任务，并把有效回答沉淀为可导出的 Artifact。

核心闭环已经打通：

```text
注册 / 登录
  → 创建项目并上传资料
  → 解析、分块、索引与向量化
  → 选择资料或执行项目检索
  → Skill Router + AgentRuntime + ProviderAdapter
  → Policy Engine 审批 Tool 调用
  → SSE 流式回答与来源展示
  → 保存 Artifact
  → 导出 Markdown / DOCX / PDF
```

## 当前能力

### 对话与模型

- DeepSeek V4 Pro / Flash：文字对话、推理、原生 `web.search` 与内部 Tool fallback。
- MiniMax M3：文字与多模态对话、图片 OCR、PDF 项目解析、原生 Tool continuation。
- Qwen3.7-Plus：默认关闭的灰度模型；启用后支持文本输出与图像、视频理解，使用 DashScope 原生多模态与 Function Calling。
- Provider 协议默认由项目自有 Adapter 承接；`AGENT_PROVIDER_ADAPTER=pi` 可把 DeepSeek / MiniMax 切到 `@earendil-works/pi-ai@0.80.7` 隔离 POC，Qwen 保持自有 Bailian Adapter。
- 模型目录由 `GET /api/chat/models` 在服务端按发布开关、工作空间和用户凭据动态裁剪。

### 项目资料与 RAG

- 项目类型：实验、复习、编程、通用。
- 单次最多上传 50 个文件，单文件 50MB，批次总量 300MB。
- 图片与项目 PDF 使用 MiniMax M3；Office/WPS/iWork 使用 MinerU；文本和代码本地解析。
- 解析任务持久化为 `FileParseJob`，服务启动后恢复 pending job，并重置异常中断的 running job。
- 检索按选中文件、项目索引、关键词/全文、pgvector 向量逐级组合；向量使用百炼 `qwen3-vl-embedding` 1024 维，失败时降级为关键词检索。
- 资料图谱按 topic / file / chunk 展示项目知识关系。
- 回答来源统一持久化到 `Message.sources` 并在消息底部展示。

### Agent、Skill 与 Tool

- `/api/chat` 已收敛为薄 HTTP/SSE 适配层，业务编排统一进入 `AgentRuntime.run()`。
- Runtime 内部由 ContextAssembler、Skill Router、ProviderAdapter、AgentLoop、ToolRunner、Policy Engine 和 Prisma persistence adapters 组成。
- 13 个内置 Skill 从 `.lumenlab/skills` 动态发现，覆盖论文、文献综述、考试、代码、PDF/Word/PPT/表格、图表规范、中文润色和苏格拉底辅导。
- 17 个内置 Tool 覆盖项目资料、成果、RAG、网页、arXiv、参考文献、DOCX 导出与 Skill 激活。
- Tool 使用 L1-L4 风险模型。L2 默认首次询问，L3 每次询问，L4 当前无生产 Tool。
- 审批 token 绑定用户、对话、Tool、请求和参数哈希；批准时重新检查当前 Tool/Skill、`User.scopes`、参数与资源归属，并用条件更新避免并发覆盖终态。
- `web.fetch` 使用域名 allowlist、完整公网 IP 判定、逐跳 DNS 校验与连接固定，防止 SSRF 和 DNS rebinding；同时限制 8 秒与 1.5MB body。

### 成果与文档转换

- Artifact 支持十余种成果类型，Markdown 是唯一正文源。
- Artifact 可导出 Markdown、DOCX、PDF；Redis 以内容哈希缓存导出结果。
- `/tools` 使用 MinerU Precision 把 PDF 转为 Markdown，保留公式、表格和图片，支持完整 ZIP 下载与保存到项目。
- Markdown 渲染支持 GFM、KaTeX、Mermaid、代码高亮与安全 HTML table。

### 账号、凭据与安全

- Auth.js v5 Credentials + JWT，密码使用 bcrypt。
- 中央模式要求 Alpha 注册码；注册码与 provider 凭据由独立的 `course-ai-regadmin` 发布加密快照。
- 主业务与管理端使用独立数据库、`ENCRYPTION_KEY` 和注册码摘要 secret。
- 同步协议使用 RSA-OAEP + AES-256-GCM（16-byte tag）+ HMAC + timestamp + nonce 防重放。
- API Key 只在服务端以 AES-256-GCM 加密存储，客户端只能看到掩码。
- 自托管模式可启用 `USER_API_KEYS_ENABLED=1`，优先读取用户 `ApiKey`，缺失时回退中央凭据。
- 项目、文件、对话、Artifact、参考文献和 Tool handler 均做用户归属校验。

## 技术架构

| 层级 | 当前实现 |
|---|---|
| Web | Next.js 16.2.10 App Router、React 19.2、TypeScript 5、Tailwind CSS 4 |
| 数据 | PostgreSQL 16、pgvector 0.8、Prisma 7.8；当前 schema 33 个 model、24 组 migration |
| AI | Anthropic SDK、DashScope 原生 HTTP、可选 `pi-ai` Provider POC |
| 缓存 | TanStack Query、React `cache()`、Redis 7 + 有界内存降级 |
| 文件 | MiniMax M3、MinerU Precision、PDF.js、`@napi-rs/canvas`、七牛云 Kodo |
| 导出 | unified/remark、docx、pdfkit、Playwright/Chromium、sharp |
| 前端 | shadcn/radix-nova、Iconoir、Motion、GSAP、D3、TanStack Virtual |
| 测试 | Vitest、Testing Library；当前仓库 131 个测试文件 |

## Runtime 发布模式

| 模式 | 行为 |
|---|---|
| `legacy` | 默认；保持兼容响应和模型驱动 Tool loop |
| `shadow` | 返回 legacy 结果，只比较无副作用的 Skill、联网与 Tool 规划决策 |
| `new` | 启用 Runtime-owned Skill 状态、确定性 Tool prelude 与统一 Tool loop |

`AGENT_ORCHESTRATOR_ENABLED` 只保留为旧部署兼容映射，新配置使用 `AGENT_RUNTIME_MODE`。

## 四层缓存

| 层 | 实现 | 当前策略 |
|---|---|---|
| 客户端 | TanStack Query | 30 秒 stale、5 分钟 GC、mutation 精确失效 |
| 请求内 | React `cache()` | 单次 Server Component 请求内去重 |
| 应用 | Redis + 内存降级 | 限流、导出缓存、指标与 RAG 缓存 |
| Provider | DeepSeek prompt cache + MiniMax 实验骨架 | 实验默认关闭；Bailian Qwen 当前记录用量 |

## 生产与发布

生产环境使用 Nginx HTTPS、Next.js standalone、systemd `lumenlab.service`、本机 PostgreSQL/Redis 与七牛云 Kodo。服务器按 `releases/<commit>` 保存运行单元，`current` 符号链接完成原子切换。

`scripts/deploy.sh` 提供 bootstrap、deploy、rollback、status：

- 部署前检查 GitHub Actions CI。
- migration 前创建 `pg_dump` 快照并保留最近 3 份。
- 3002 端口执行新 release 健康预检。
- 切换后同时检查本机 3000 和 HTTPS `/api/health`。
- 失败时恢复上一 release；服务器保留当前与一个可回滚版本。

CI 在 Ubuntu 上执行依赖安装、Prisma、lockfile、lint、TypeScript、全量测试、pgvector migration、build 和 whitespace check，并在 macOS 上复核 lockfile 一致性。

## 当前边界

- Qwen3.7-Plus 与 `pi-ai` 仍是默认关闭的发布 POC，不代表所有生产账号已开放。
- `legacy` 仍是 Runtime 默认模式；`shadow` / `new` 需要显式配置。
- Prompt 重排与 MiniMax 主动缓存实验默认关闭，启用前应先收集基线。
- Agent 审批后会立即执行 Tool 并显示终态，但不会自动恢复此前暂停的 Provider continuation；需要用户发送下一条消息继续。
- `web.fetch` 只访问 `WEB_FETCH_ALLOWLIST` 中通过公开地址校验的域名。

## 关键文档

- [README](README.md)：GitHub 项目展示、快速开始与生产发布。
- [在线文档源](docs/LumenLabDocs/README.md)：用户指南、架构与 API 参考。
- [Skills](SKILLS.md)：13 个 Skill、17 个 Tool 与审批模型。
- [Implementation](IMPLEMENTATION.md)：四层缓存实现。
- [Product](PRODUCT.md)：产品定位与设计原则。
- [QA: Pi/Qwen POC](docs/qa/pi-ai-qwen-poc-2026-07-16.md)：Provider POC 的实现与验证记录。
