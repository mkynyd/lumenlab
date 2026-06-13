# MiniMax Token Plan 其他工具接入

> 来源: https://platform.minimaxi.com/docs/token-plan/other-tools

## 通用配置

不同 AI 编程工具的接入方式类似，核心配置项为：

| 配置项 | 值 |
|--------|-----|
| API Base URL | `https://api.minimaxi.com/anthropic`（Anthropic 兼容）或 `https://api.minimaxi.com/v1`（OpenAI 兼容） |
| API Key | MiniMax 订阅 Key |
| 推荐模型 | `MiniMax-M3` |

---

## 支持的工具列表

- **Claude Code** — 详见 Claude Code 专属配置页
- **Cursor** — 详见 Cursor 专属配置页
- **TRAE** — 详见 TRAE 专属配置页
- **OpenCode** — 支持 MCP 方式接入
- **Kilo Code** — 支持 API key 配置
- **Grok CLI** — 支持自定义 endpoint
- **Codex CLI** — OpenAI 兼容接口
- **Droid** — 支持自定义模型配置
- **OpenClaw** — 详见 OpenClaw 专属配置页
- **Hermes Agent** — 详见专属配置页

## 通用步骤

1. 获取 MiniMax 订阅 Key（订阅管理 > Token Plan）
2. 在工具的 API 配置中填入 Base URL 和 API Key
3. 设置模型为 `MiniMax-M3`
4. 测试调用确认可用
