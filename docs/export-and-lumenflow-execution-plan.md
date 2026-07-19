# LumenFlow、PDF 与 Word 导出执行方案

> 状态：待审阅
>
> 范围：LumenLab 学生端的 Markdown 图表渲染、成果库导出、PDF 转 Markdown 完整包导出
>
> 本文是实施合同。审阅通过后按阶段顺序落地，不在实施中临时扩大到无关的 Agent、鉴权或数据库业务逻辑。

## 1. 目标与边界

### 目标

1. 让简单业务流程图可使用与报告截图一致的卡片式视觉，复杂图仍可使用 Mermaid。
2. 消除成果库图片型内容导出 PDF 为空白的问题，并使 PDF 与站内预览保持同一视觉语义。
3. 将 DOCX 从“基础 Markdown 节点拼装”升级为可控的中文文档版式，稳定处理标题、正文、列表、表格、公式、图片和图表。
4. 修复转换完整包中错误产物被永久缓存、用户无法重新生成的问题。
5. 为上述能力建立内容级验收，避免“文件能下载、测试通过，但打开是空白或排版失真”。

### 不在本轮范围内

- 不修改登录、权限、项目归属、Agent Runtime 或现有 API 的鉴权语义。
- 不把所有 Mermaid 改写为 LumenFlow。
- 不试图使 DOCX 完全像网页；DOCX 的目标是专业、稳定、可编辑的文档，而非网页像素级复刻。
- 不在未确认前清理生产对象存储中的历史完整包。

## 2. 当前问题与设计结论

| 场景 | 当前实现 | 已确认问题 | 本次处理方式 |
|---|---|---|---|
| 成果库 PDF | PDFKit 直接遍历简化 Markdown AST | 图片节点未渲染；纯图片内容会得到空白页；Mermaid 只是源码文本 | 切换至 Chromium 打印受控的成果打印页 |
| 转换工具完整包 PDF | Chromium 打印转换详情页 | 首次坏产物会永久缓存；无内容校验与重建入口 | 增加内容指纹、质量校验、重新生成与历史修复 |
| 全部 DOCX | `docx` 库直接拼装段落/表格 | 标题、正文、列表、表格没有成熟的文档样式合同；原始 HTML 表格、公式、图表不可靠 | Pandoc + 受版本控制的 `reference.docx` |
| 流程图 | Mermaid → SVG 自动布局 | 无法稳定表达卡片、强调节点、回路和两行布局 | 新增受限的 `lumenflow` DSL；复杂图保留 Mermaid |

结论：PDF 选择 Chromium，DOCX 选择 Pandoc，LumenFlow 作为小型业务流程图的专用渲染格式。三者共享同一个 Markdown 内容源和同一套资源归属校验，但不强行共享同一个文件生成器。

## 3. 目标架构

```text
AI / 用户 Markdown
        |
        +-- lumenflow 代码块 --> LumenFlow 解析与卡片组件
        |
        +-- mermaid 代码块 ----> Mermaid SVG（复杂图兜底）
        |
        +-- 图片 / 表格 / 公式 --> 规范化文档模型
                                  |
                     +------------+------------+
                     |                         |
              Chromium 打印页              Pandoc DOCX
                     |                         |
                   PDF                  reference.docx + 图片/图表
```

导出前增加两层保护：

1. **资源规范化**：只接受当前用户拥有的图片资源；拒绝路径穿越、未知相对路径和未授权 URL。
2. **质量门槛**：PDF 必须可解析且至少有一页有效内容；DOCX 必须是可打开的 OOXML 包，包含预期样式和已解析媒体资源。

## 4. 工作包 A：LumenFlow 卡片流程图

### A1. 输出契约

新增 `lumenflow` fenced code block，只用于不超过 12 个节点、简单线性/小分支业务流程。模型输出严格 JSON：

```lumenflow
{
  "version": 1,
  "nodes": [
    { "id": "ui", "label": "Web / Mobile UI" },
    { "id": "api", "label": "Chat API" },
    { "id": "run", "label": "AgentRun record", "tone": "primary" },
    { "id": "worker", "label": "Durable queue / worker" }
  ],
  "edges": [
    ["ui", "api"],
    ["api", "run"],
    ["run", "worker"]
  ],
  "returnFlow": {
    "label": "needs approval",
    "text": "Suspended-run snapshot → approve / reject → Resume command → worker"
  }
}
```

约束：`version = 1`、节点 ID 唯一、节点不超过 12 个、边不超过 16 条、标签长度受限、只允许 `default`/`primary` 两种色调。解析失败、节点过多、复杂分支、时序/类/状态图都回退至 Mermaid 或原始代码块。

### A2. 前端实现

- 新增纯 React/CSS 的 `LumenFlowDiagram`，使用圆角白卡、蓝色重点卡、箭头、回路文字与响应式横向滚动；不依赖网络或运行时 SVG 图形服务。
- 在共享 Markdown 入口识别 `language-lumenflow`，因此聊天、项目预览、转换预览和成果库都一致生效。
- 同步更新聊天虚拟列表的图表高度预估，避免流式消息渲染后跳动。
- 深色模式保持可读性；卡片与按钮遵守现有“无可见边框、无深灰 hover”的 UI 合同。

### A3. Prompt 工程

全局系统提示词增加“何时优先 LumenFlow”的规则、一个正例和反例：

- 正例：4–8 个业务步骤、审批、数据流、任务流程。
- 反例：不要把 Mermaid 语法、HTML、CSS、`classDef` 或解释性文字塞入 `lumenflow`；不要用它表达时序图、ER 图、类图或超过 12 节点的复杂架构。
- 失败策略：JSON 无法保证合法时，输出普通 Mermaid，不输出半截 LumenFlow。

### A4. 导出行为

- PDF：打印页直接渲染同一个 LumenFlow React 组件，因此视觉与站内保持一致。
- DOCX：导出前将 LumenFlow 渲染为本地 SVG/PNG，作为图片嵌入；不将 JSON 源码作为最终图表正文。

### A5. 验收

- 合法 JSON、非法 JSON、超节点数、重复 ID、无效边、深浅主题、窄屏布局的单元/组件测试。
- 聊天、成果库、转换预览均出现同一张图。
- PDF 含可见卡片图；DOCX 含一个嵌入式图像媒体文件。

## 5. 工作包 B：PDF 导出可靠性

### B1. 统一渲染引擎

1. 将现有浏览器打印封装泛化为 `renderAuthenticatedPrintPage`。
2. 新增成果打印页，仅渲染受鉴权保护的 Artifact 内容，并复用共享 Markdown 组件。
3. 成果库 PDF 改为调用该打印页，废弃 PDFKit 的直接 Markdown 绘制路径。
4. 转换详情 PDF 保留 Chromium 路径，但与成果 PDF 复用等待字体、图片、Mermaid、LumenFlow 就绪的逻辑。

这样图片、公式、表格、Mermaid、LumenFlow 的 PDF 表现不再由第三套简化渲染器决定。

### B2. 输出质量校验

新增 `validatePdfExport`：

- 校验 `%PDF` 头、可解析性和页数。
- 使用已存在的 `pdfjs-dist` 检查每页文本或绘制对象；图片型页面也应被视为有效内容。
- 对首尾页做轻量光栅抽样，排除“全白页面”。
- 失败时不写缓存、不更新导出记录，并记录结构化诊断：打印 URL、是否重定向、就绪标记、图片数量、待渲染图表数量、页数和失败阶段。

### B3. 缓存与恢复

`DocumentConversion` 增加导出内容指纹与渲染器版本，指纹由 Markdown、已授权资源清单和导出格式版本组成。

- 指纹匹配且质量校验已通过：复用缓存。
- 指纹或版本不匹配：重新生成。
- 用户可点击“重新生成完整包”；此操作只影响本人拥有的转换记录。
- 生产历史坏包修复采用单独的管理员脚本：先列出候选、验证、记录结果，再由明确授权执行清理或重建。脚本不默认删除对象。

### B4. 验收

- 文字型、纯图片型、长表格型、Mermaid/LumenFlow 型样稿都导出非空 PDF。
- 首次导出失败不会生成缓存；后续重试可成功。
- 同内容命中缓存；改 Markdown、图片或渲染器版本必定重建。
- 打印页登录失效、图片读取失败、Chromium 缺失时给用户明确错误，不返回“可下载但空白”的文件。

## 6. 工作包 C：Pandoc DOCX 引擎

### C1. 运行时与安全

- Docker 运行镜像安装 `pandoc`；启动自检记录版本。
- Node 通过 `spawnFile` 调用 Pandoc，禁止拼接 shell 字符串。
- 每次导出在受限临时目录中放置 Markdown、已授权图片、规范化图表与输出文件；完成后清理。
- 仅把项目/转换记录已拥有的资源写入临时目录；所有路径保持 `pics/` 相对路径约束。
- Pandoc 不可用、超时或写出失败时明确报错，不静默回退到旧 DOCX 引擎。

### C2. 文档样式合同

新增并版本控制 `reference.docx`。它是 DOCX 版式唯一来源，至少定义：

- A4 纸张、统一页边距、页眉页脚和页码。
- 中文正文、标题 1–3、代码、引用、图注、表格标题和参考文献样式。
- 正文行距、段前段后、首行缩进、标题与正文不拆页、表格跨页重复表头。
- 合理的图片最大宽度与居中策略。

默认采用面向学生报告/学习资料的“正式中文文档”样式，而不是网页 UI 样式。Pandoc 的 `--reference-doc` 会复用其中的样式、页面属性、页边距、页眉和页脚。

### C3. 内容规范化

Pandoc 负责语义 Markdown → DOCX，但在调用前需要规范化：

1. 将 MinerU 保留的原始 HTML 表格转为 Pandoc 可识别的表格结构。
2. 将 Mermaid/LumenFlow 转为本地 SVG/PNG 引用。
3. 确保图片路径与临时资源目录一致，并为失败资源提供可见占位说明。
4. 保留公式、任务列表、代码块、引用、嵌套列表和中英文混排的语义。

### C4. 渐进替换与回滚

- 首先以 `DOCX_EXPORT_ENGINE=pandoc` 特性开关启用，默认在测试环境比较新旧导出。
- 稳定后将 Pandoc 设为默认；保留旧 `docx` 引擎一个发布周期，仅作受控回滚。
- 回滚不影响既有 Artifact 和 Conversion 数据，因为源 Markdown 与图片资源保持不变。

### C5. 验收

- DOCX 可由 Microsoft Word 与 LibreOffice 打开，无修复提示。
- 样稿中标题、正文、长表格、公式、图片、图表、代码和列表均满足样式合同。
- 解包检查存在预期的样式、`word/media` 图片和有效文档关系。
- 在 CI 或专用验证环境中用 LibreOffice 无头转 PDF，再执行 PDF 内容/视觉检查。

## 7. 实施顺序与交付物

### 阶段 0：固定问题与测试基线

- 新建“中文正文 + 图片 + HTML 表格 + 公式 + Mermaid + LumenFlow”导出样稿。
- 补齐当前两条 PDF、两条 DOCX 导出链路的路由级测试。
- 输出历史完整包候选清单，但不清理生产数据。

**交付物**：可重复的失败样稿、导出质量断言、历史缓存审计结果。

### 阶段 1：先恢复 PDF 正确性

- 成果库接入 Chromium 成果打印页。
- 统一导出就绪标记、PDF 校验与结构化日志。
- 为转换完整包增加版本化缓存与用户级重新生成入口。

**完成标准**：纯图片 Artifact PDF 不再为空；任何失败不会写入可复用缓存。

### 阶段 2：落地 Pandoc DOCX

- Docker 加入 Pandoc；实现安全调用器和运行时自检。
- 创建、校验并接入 `reference.docx`。
- 接入资源临时目录、HTML 表格规范化、图片和图表嵌入。
- 以特性开关灰度替换旧引擎。

**完成标准**：Word/LibreOffice 均可打开样稿，版式通过人工与自动检查。

### 阶段 3：落地 LumenFlow 与导出衔接

- 新增 DSL、解析器、卡片组件、Markdown 接线和 Prompt 规则。
- 让 PDF 直接打印卡片图，让 DOCX 嵌入图表图像。
- 将 Mermaid 保留为复杂图回退方案。

**完成标准**：站内、PDF、DOCX 对同一业务流程的表达一致；复杂图无回归。

### 阶段 4：上线、修复历史产物与观察

- 先部署新导出引擎，再按审计结果修复受影响的历史完整包。
- 观察导出成功率、质量校验失败率、缓存命中率、Pandoc/Chromium 耗时与失败原因。
- 一周发布观察后移除旧 DOCX 引擎的默认路径。

## 8. 预计改动范围

| 模块 | 预计动作 |
|---|---|
| `src/components/markdown/*` | 接入 LumenFlow、共享导出就绪状态 |
| `src/components/artifact/*` | 增加成果打印页/重新生成反馈 |
| `src/components/tools/*` | 完整包重新生成入口与失败提示 |
| `src/lib/export/*` | Chromium 打印泛化、PDF 校验、Pandoc DOCX、资源与图表规范化 |
| `src/lib/ai/prompts.ts` | LumenFlow 规则、正例和反例 |
| `src/lib/chat-message-layout.ts` | LumenFlow 高度估算 |
| `src/app/api/artifacts/**` | PDF/DOCX 新引擎接线 |
| `src/app/api/tools/conversions/**` | 版本化缓存、重建与质量校验 |
| `prisma/schema.prisma` + migration | 转换完整包指纹、渲染器版本、质量状态/摘要 |
| `Dockerfile` | 安装 Pandoc |
| `assets/export/reference.docx` | 受版本控制的 DOCX 样式模板 |
| `scripts/*` | 历史坏完整包审计/受控修复脚本 |
| tests | 单元、路由、组件、真实 Chromium/Pandoc 集成验收 |

## 9. 风险与控制

| 风险 | 控制方式 |
|---|---|
| Pandoc 在生产镜像不存在 | Docker 安装 + 健康自检 + 明确错误，不静默降级 |
| Pandoc 无法理解 MinerU 原始 HTML 表格 | 先规范化为表格语义，再生成 DOCX |
| 图表在 DOCX 中丢失 | Mermaid/LumenFlow 预渲染为本地图片，并检查 `word/media` |
| Chromium 打印遇到认证/资源加载失败 | 记录打印页 URL、登录状态、就绪标记、图片/图表数量；失败不缓存 |
| 历史坏包清理误伤用户文件 | 先审计、再用户授权；只清理可再生的 ZIP 缓存，不触碰原 PDF、Markdown、图片或项目资料 |
| 新引擎带来性能回退 | 缓存以内容指纹复用；记录耗时；DOCX 引擎经特性开关灰度 |

## 10. 审阅决策点

以下默认选择已写入方案；如无异议，实施时按此执行：

1. **PDF 引擎**：Chromium 为唯一正式 PDF 引擎，移除成果库 PDFKit 路径。
2. **DOCX 引擎**：Pandoc 为正式引擎，使用项目内 `reference.docx`；旧引擎仅保留一个发布周期作回滚。
3. **Word 风格**：正式中文学习资料/实验报告风格，而非网页风格。
4. **流程图范围**：LumenFlow 仅处理小型业务流程；Mermaid 保留作复杂图兜底。
5. **历史缓存**：先只生成审计清单；清理或重建生产历史完整包前必须再次获得明确授权。

## 11. 通过条件

本方案完成的定义不是“多了三个导出按钮”，而是同时满足：

- 图片型成果的 PDF 非空且可读。
- 每种导出样稿均通过内容级和打开级验证。
- DOCX 在常见 Word/LibreOffice 环境中有稳定的中文排版。
- LumenFlow 在网页、PDF、DOCX 中保持语义一致。
- 出错产物不会被缓存为成功结果，用户能自行重新生成。
- 所有新路径保留用户归属校验、私有资源访问与现有 API 安全边界。
