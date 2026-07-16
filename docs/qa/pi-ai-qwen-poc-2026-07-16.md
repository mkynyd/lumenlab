# Pi Adapter 与 Qwen3.7-Plus POC 验收

日期：2026-07-16
结论：通过；保持 `legacy` 为默认模型协议层，Pi 仍是可回退的隔离 POC。

## 实现边界

- `@earendil-works/pi-ai` 精确锁定为 `0.80.7`，Pi 仅注册 DeepSeek 与 MiniMax provider。
- `AGENT_PROVIDER_ADAPTER=legacy | pi` 控制 DeepSeek/MiniMax 的协议层；旧值 `pi-ai` 仅作兼容别名。
- Pi 只翻译供应商协议和流式事件。现有 Runtime、`runAgentLoop`、ToolRunner、Policy、审批、审计和中央 Credential Profile 均未替换。
- Qwen3.7-Plus 通过 DashScope 原生接口单独接入；启用 `MODEL_QWEN_ENABLED=true` 且服务端确认 workspace 与 Bailian 凭据后，才会出现在模型菜单。
- Qwen 仅支持文本输出、文本/图像/视频理解；没有实现或验收图像、视频生成。

## 验收证据

| 范围 | 结果 |
|---|---|
| Pi / DeepSeek V4 Pro、Flash | 本地真实浏览器请求均返回预期文本与思考流。 |
| Pi / MiniMax M3 图像理解 | 浏览器上传独立的大尺寸红色 PNG，模型正确返回“红色”。 |
| Pi / 原生 Tool Call | 真实联网请求显示三次工具调用、来源聚合和最终文本，工具仍经过既有 Runtime/ToolRunner 链路。 |
| Pi / thinking、cache token、abort、错误 | Pi 适配器契约测试覆盖思考事件、usage/cache 字段、AbortError 和状态码友好映射；浏览器实测验证模型层已使用 Pi 且没有再触发上游 dotted-tool-name 格式拒绝。 |
| Qwen / 文本与 thinking | 真实 DashScope SSE 返回 reasoning、文本和 usage/cache 字段。 |
| Qwen / Tool Call | 真实原生 Function Calling 流经分片解析、ToolRunner 续轮后返回后续文本。 |
| Qwen / 图像与视频理解 | 真实 PNG 与短视频输入均返回文本理解结果；视频使用短期受限对象存储链接，流结束或取消时删除临时对象。 |
| Qwen / abort 与错误 | 真实 AbortSignal 归一为 `AbortError`；过小图像的上游拒绝归一为可读的 Qwen 错误。 |
| Qwen / UI | `/api/chat/models` 与模型选择器仅在服务端 gate 通过时展示 Qwen；浏览器选择并完成一轮文本对话。 |

## 回归

- `npm test -- --run`：131 文件、694 测试通过。
- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，包含 `/api/chat/models` 路由。
- `git diff --check`：通过。

## 安全与发布

- 凭据继续由中央 Credential Profile 解析；本 POC 未采用 Pi 的本地认证文件。
- 本报告、代码和受版本控制配置均未写入密钥、账户标识、工作空间标识、签名链接或原始 provider 响应体。
- 未提交、未推送、未部署。生产切换前仍建议保持 `legacy`，在目标环境复验相同矩阵后再做灰度决策。
