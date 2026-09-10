# 成果库与导出

## 设计目标

项目聊天中的 AI 回复可以由用户手动保存为 Artifact。系统不会自动保存每条回复，也不会为复习提纲、模拟题、实验报告等分别建立数据表，而是通过 `Artifact.type` 区分成果用途。

## 唯一内容源

`Artifact.content` 始终保存原始 Markdown。Markdown 是唯一事实来源，DOCX 和 PDF 仅在下载请求发生时即时生成，不写回数据库，也不修改原文。

## 导出格式

- Markdown：直接以 UTF-8 `.md` 文件下载。
- Word：使用 `docx` 从 Markdown AST 生成 `.docx`，支持标题、段落、粗体、斜体、代码块、列表、表格、引用和分隔线。
- PDF：渲染同源的打印页并用 Chromium（`playwright-core`）导出 `.pdf`，因此 Mermaid 与 KaTeX 公式在 PDF 中同样是渲染后的结果；需要配置 `CHROMIUM_EXECUTABLE_PATH`。

导出接口：

```text
GET /api/artifacts/{id}/export?format=markdown
GET /api/artifacts/{id}/export?format=docx
GET /api/artifacts/{id}/export?format=pdf
```

所有接口都校验登录状态和 Artifact 的 `userId`。下载文件名会清理路径字符、换行和响应头危险字符。

## 当前限制

- DOCX 中的 Mermaid 仍以源码文本保留；PDF 走打印页，渲染为真实图形。
- LaTeX 公式在 PDF 中由 KaTeX 渲染；DOCX 不转换为 Word 公式对象。
- 导出结果缓存 1 小时（Redis，命中时返回 `X-Cache: HIT`），不记录导出历史。

## 部署要求

PDF 导出使用 Node.js runtime 并需要可用的 Chromium（`CHROMIUM_EXECUTABLE_PATH`，服务器上由部署脚本提供）。PDF 资料解析使用 `pdfjs-dist` 与 `@napi-rs/canvas`，扫描型 PDF 最多同步处理前 8 页。

后续可以扩展学校模板封面、实验报告固定格式与导出历史。
