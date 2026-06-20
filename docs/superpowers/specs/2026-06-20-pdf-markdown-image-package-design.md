# PDF 转 Markdown 图片归档与完整导出设计

日期：2026-06-20
状态：已获用户批准

## 1. 目标

修复 MinerU PDF 转 Markdown 流程只保留 `full.md`、丢弃 ZIP 内图片的问题，并把图片纳入转换记录的完整生命周期。新转换应支持：

- 转换完成页和历史详情页使用与对话区一致的完整 Markdown 渲染能力与 `.markdown-body` CSS，包括 GFM、数学公式、代码高亮、Mermaid 和图片。
- 下载一个完整 ZIP，包含 Markdown、`pics/` 图片目录、使用同款 Markdown CSS 打印的 PDF，以及真正嵌入图片的 DOCX。
- 单独下载 Markdown，保留现有“保存到项目”，移除“复制 Markdown”。
- 保存到项目后复制图片资源，使项目文件不依赖原转换记录的生命周期。
- 删除转换或项目文件时同步清理关联对象存储资源与缓存导出物。

## 2. 当前问题

`src/lib/parse/mineru.ts` 当前下载 MinerU 的完整 ZIP 后，只读取 Markdown 条目并统计图片数量。ZIP 中的图片 Buffer、相对路径和 MIME 信息没有返回给调用方。`DocumentConversion` 只持久化 `markdownContent`；转换页面的单文件下载也只在浏览器端创建 Markdown 文本文件。

另外，当前 PDFKit 和 DOCX 导出器都把图片节点退化成文本。PDFKit 不执行浏览器 CSS，无法满足“与对话区同款 CSS”的要求。

## 3. 方案比较

### 方案 A：图片独立持久化，导出包按需生成（采用）

MinerU 结果解压时解析 Markdown 实际引用的内部图片，规范化到 `pics/`，逐个写入本地或七牛对象存储，并保存资源清单。预览通过鉴权资源路由读取图片；完整包首次下载时生成并缓存。

优点：历史预览高效、权限边界明确、删除和项目复制可控。缺点：需要资源表、对象存储通用接口和较完整的清理逻辑。

### 方案 B：只保存 MinerU 原始 ZIP

预览每张图片时从 ZIP 中查找并解压。实现量较少，但对象存储下载和 ZIP 解压会被每个图片请求重复触发，横向扩展和缓存复杂。

### 方案 C：图片以 Base64 写入 Markdown

无需资源路由，但会使数据库文本、SSE 响应、浏览器内存和项目索引显著膨胀，不适用于接近 200 页的课程资料。

## 4. 数据模型与存储

### 4.1 转换图片

新增 `DocumentConversionAsset`：

- `id`
- `conversionId`
- `relativePath`：规范化后的 `pics/<filename>`，在同一转换内唯一
- `mimeType`
- `size`
- `storageProvider`
- `storagePath`
- `createdAt`

`DocumentConversion` 增加图片关系和可空的缓存包引用字段，包括存储 provider、path、size 与生成时间。缓存只在第一次下载完整包时生成；转换完成不等待 PDF/DOCX/ZIP 导出。

### 4.2 项目图片

新增 `FileAssetResource`，字段与转换图片相同，以 `fileAssetId` 关联项目文件。保存到项目时复制 Markdown 和所有图片对象，不共享转换资源引用。项目 Markdown 保持可移植的 `pics/...` 相对路径；项目预览在渲染时把相对图片地址映射到鉴权资源 API。

本功能不改变 RAG 的文本索引语义，也不在本轮把项目图片自动作为 MiniMax 视觉附件发送。项目侧的验收范围是资源独立保存、预览可见和删除可清理。

### 4.3 对象键与权限

对象键按用户和资源归属分区，服务器生成，客户端不能提交对象键：

```text
users/<userId>/conversions/<conversionId>/assets/<assetId>/<filename>
users/<userId>/conversions/<conversionId>/exports/<exportId>.zip
users/<userId>/projects/<projectId>/files/<fileId>/resources/<resourceId>/<filename>
```

所有读取都先验证当前用户对转换或项目文件的归属。API 不向客户端返回私有 bucket 内部键。

## 5. MinerU ZIP 规范化

下载完成后解析 Markdown 条目的所在目录，并处理 Markdown 图片语法与 HTML `<img src>`：

1. `http:`, `https:`, `data:` 图片保持原样，不归档。
2. 内部相对路径按 Markdown 文件目录解析，并拒绝绝对路径、目录穿越、空路径和 ZIP 外引用。
3. 只保存 Markdown 实际引用的资源；MinerU 未引用的页面切片、调试图和中间产物不保存。
4. 所有已引用图片都会保存，不再用 10KB 阈值决定是否保留。
5. 文件名清理后扁平化到 `pics/`；重名使用稳定短哈希消歧。
6. Markdown 中的引用同步重写为 POSIX 相对路径 `pics/<filename>`。
7. 任一内部引用在 ZIP 中不存在时，转换失败并返回缺失路径，不创建不完整记录。

解析结果返回规范化 Markdown、图片 Buffer 清单和现有 MinerU 元数据。数据库记录与对象上传必须具备补偿清理：任何一步失败，都删除已上传图片，不留下半成品转换。

## 6. 预览与界面

提取一个共享的完整 Markdown 渲染组件，供对话消息、转换完成结果、历史详情及项目预览复用。能力包括：

- `remark-gfm`
- `remark-math` + `rehype-katex`
- `rehype-highlight`
- Mermaid 代码块
- `.markdown-body` 和 `.workbench-readable` 样式
- 可注入的图片 URL 解析器

转换完成后的页面不再显示截断的 `<pre>` 源码，而直接显示完整渲染结果。历史详情页使用同一组件。相对 `pics/...` 地址被映射到 `/api/tools/conversions/<id>/assets/...`，图片带安全的懒加载与替代文本行为。

操作区保留：

- “下载完整包”（主操作）
- “下载 .md”（次操作）
- “保存到项目”

删除“复制 Markdown”。旧转换没有图片清单时仍可查看文字，并显示“该记录创建于图片归档功能上线前”；不会声称能恢复其图片。

## 7. 完整 ZIP 导出

ZIP 根目录使用清理后的原 PDF 基础名称：

```text
<base-name>/
├── <base-name>.md
├── <base-name>.pdf
├── <base-name>.docx
└── pics/
    └── <normalized-images>
```

Markdown 中的内部图片始终引用 `pics/...`。响应使用 `application/zip` 和安全的 UTF-8 下载文件名。

### 7.1 PDF

使用 Chromium/Playwright 打印专用转换页面，而不是扩展现有 PDFKit。打印页面复用生产页面的共享 Markdown 渲染器和 CSS，隐藏导航与操作控件，等待图片、字体、KaTeX、代码高亮和 Mermaid 完成后再调用 `page.pdf()`。导出请求只转发当前请求的认证 cookie，不创建公开 URL。

Docker/生产运行时增加 Chromium 依赖，并提供可配置的可执行文件路径。浏览器启动失败、资源加载失败或渲染超时只使本次导出失败，不破坏已完成转换。

### 7.2 DOCX

扩展 Markdown AST 导出器，解析图片节点，从转换资源清单读取 Buffer，以 `ImageRun` 嵌入 DOCX。浏览器可显示但 DOCX 不稳定支持的 WebP、SVG、GIF 等格式先用 `sharp` 转成 PNG；PNG/JPEG 可直接嵌入。图片按页面可用宽度等比缩放。

本轮保持现有标题、列表、表格、代码块和公式文本行为，不把 DOCX 排版扩展为完整浏览器 CSS 仿真。

### 7.3 缓存与并发

完整包首次请求按需生成。成功后上传对象存储并原子更新缓存引用，后续请求直接读取缓存。并发首次请求允许生成临时候选包；数据库条件更新只保留一个，未采用的候选对象立即删除。图片或 Markdown 发生变化时清除旧缓存；正常转换记录创建后内容不可编辑，因此缓存稳定。

## 8. 生命周期与失败处理

- 删除转换：删除缓存 ZIP 和全部 `DocumentConversionAsset` 对象，再删除数据库记录；对象删除失败记录日志并返回失败，避免无提示泄漏。
- 保存到项目：先复制资源并上传 Markdown，再创建 `FileAsset` 与资源记录；失败执行逆序补偿清理。
- 删除项目文件或项目：沿用现有归属校验，并补充关联资源对象清理。
- 缺少图片、非法 ZIP 路径或不支持的 MIME：转换失败并给出明确错误。
- 导出失败：保留转换和图片，用户可重试。
- 旧记录：文字功能继续可用；完整包可以导出文字版，但界面明确标识无图片归档，不伪造缺失图片。

## 9. API 轮廓

新增或扩展以下鉴权路由：

- `GET /api/tools/conversions/:id/assets/:assetId`：转换图片。
- `GET /api/tools/conversions/:id/download`：完整 ZIP，命中缓存时直接返回。
- `GET /api/files/:id/resources/:resourceId`：项目文件图片。
- `POST /api/tools/conversions/:id/save-to-project`：复制图片资源并创建独立项目文件。
- `DELETE /api/tools/conversions/:id`：增加对象资源清理。

现有 SSE 转换事件在 `done` 中继续返回转换 ID 和 Markdown，并增加资产数量。内部对象键不会进入 SSE 或普通详情 JSON。

## 10. 测试与验收

### 自动测试

- MinerU ZIP 夹具：嵌套 Markdown、中文文件名、重名图片、Markdown/HTML 图片、外部 URL、路径穿越和缺失图片。
- 存储补偿：上传中途失败、数据库创建失败、删除失败、项目复制失败。
- 鉴权：未登录、跨用户访问、非法 asset ID、已删除资源。
- ZIP：目录结构、四类文件、相对路径和图片字节一致。
- DOCX：解包后 `word/media/` 包含真实图片。
- PDF：文件头有效，打印页达到资源就绪状态，并验证至少一张图片被加载。
- UI：转换完成和历史页面均使用完整渲染器；不存在“复制 Markdown”；存在完整包、`.md` 和项目操作。
- 回归：现有转换列表、删除、保存项目、Artifact 导出和项目文件功能继续通过。

### 真实文件验收

使用：

```text
/Users/yinjunhang/Downloads/电路原理高分精选考题.pdf
```

该文件当前存在，大小 11,777,533 字节。若本地账户具备可用 MinerU 凭据，则执行真实转换并检查：

1. 转换预览中的电路图可见。
2. ZIP 内 Markdown 的每个内部图片引用都能解析到 `pics/` 文件。
3. PDF 中电路图可见且样式与转换预览一致。
4. DOCX 在 Word/LibreOffice 中打开后图片为内嵌资源。
5. 保存到项目后删除原转换，项目预览图片仍可见。

若环境缺少可用 MinerU 凭据，只跳过真实 API 调用并明确报告；自动 ZIP 夹具测试仍必须全部通过。

## 11. 非目标

- 恢复旧转换已经丢失的图片。
- 把项目图片自动作为视觉附件发送给聊天模型。
- 让 DOCX 逐像素复刻浏览器 CSS。
- 保存 MinerU ZIP 中未被 Markdown 引用的中间产物。
