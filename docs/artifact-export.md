# 成果库与导出

## 正文与下载

`Artifact.content` 保存原始 Markdown，标题与类型独立记录。用户可以手工保存助手回答，也可在聊天中要求保存并导出。导出读取同一正文，下载时重新验证登录与成果归属。

```text
GET /api/artifacts/{id}/export?format=markdown
GET /api/artifacts/{id}/export?format=docx
GET /api/artifacts/{id}/export?format=pdf
```

文件名清理路径字符、换行和响应头危险字符。导出结果缓存1小时，键包含正文和渲染器版本，命中返回 `X-Cache: HIT`。

## Word 渲染

入口为 `src/lib/export/markdown-to-docx.ts` 的 `markdownToDocx()`。

- 默认调用 Pandoc，使用参考 DOCX 与统一中文样式。数学公式由 Pandoc 处理，Mermaid / LumenFlow 渲染为图片后嵌入，项目图片经授权解析后写入文档。
- 主机未安装 Pandoc 时，自动回退到纯 JS `docx` 渲染器；设置 `DOCX_EXPORT_ENGINE=legacy` 可显式选择备用路径。Pandoc 其他错误会直接报告。
- 备用路径支持基本标题、列表、表格、引用、代码与图片，复杂公式和图表的保真能力受引擎限制。部署和验收时应记录实际使用的引擎。
- 两条路径共用 Noto Sans SC 东亚字体和 `zh-CN` 样式，并嵌入 OFL 中文字体。阅读器未支持字体嵌入时，显示取决于本机字体。

`artifact.export_docx` 复用同一渲染器和缓存，只返回包含 `downloadUrl`、文件名、MIME 类型与字节数的小型下载引用。DOCX 二进制与字体数据保留在下载链路内，每次下载校验成果归属。

## PDF 与 Markdown

Markdown 直接以 UTF-8 下载。PDF 使用服务端 Chromium 打印同源渲染页面，包含 KaTeX 数学公式与图表，需配置 `CHROMIUM_EXECUTABLE_PATH`。

## 输入与运行依赖

项目资料 PDF 由 MiniMax M3.1 解析，必要时回退 MinerU。聊天 PDF/DOCX 优先提取正文，扫描 PDF 使用有数量上限的页图。学习扫描通过 PDF.js 和 canvas 生成临时预览，Office 预览另需 LibreOffice。各入口的原件、图片资源和临时素材按独立归属与生命周期管理。

详细说明见[资料与 RAG](LumenLabDocs/guides/files-and-rag.md)和[部署](LumenLabDocs/deployment.md)。
