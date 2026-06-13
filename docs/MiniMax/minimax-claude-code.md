# MiniMax M 系列模型在 Claude Code 中使用

> 来源: https://platform.minimaxi.com/docs/token-plan/claude-code

本页面介绍如何将 Claude Code 的后端替换为 MiniMax 的 API。

---

## 前置准备：清除环境变量

配置前必须清除已有的 Anthropic 环境变量：

```bash
unset ANTHROPIC_AUTH_TOKEN
unset ANTHROPIC_BASE_URL
```

如果这些变量永久导出在 `~/.bashrc` 或 `~/.zshrc` 中，需要从这些文件中移除相应行。

---

## 配置方法一：手动编辑文件（推荐）

编辑 `~/.claude/settings.json`（macOS/Linux）或 `%USERPROFILE%\.claude\settings.json`（Windows）：

| 变量 | 值 |
|------|-----|
| `ANTHROPIC_BASE_URL` | `https://api.minimaxi.com/anthropic` |
| `ANTHROPIC_AUTH_TOKEN` | 你的 MiniMax API key |
| `API_TIMEOUT_MS` | `3000000` |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` |
| `ANTHROPIC_MODEL` | `MiniMax-M3` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `MiniMax-M3` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `MiniMax-M3` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `MiniMax-M3` |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `512000` |

> `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 设为 512000，与 MiniMax-M3 的上下文窗口保持一致。

此外，`~/.claude.json` 必须包含 `"hasCompletedOnboarding": true` 以跳过引导流程。

---

## 配置方法二：使用 cc-switch（GUI 工具）

开源工具 [cc-switch](https://github.com/farion1231/cc-switch) 提供图形化切换：

- **macOS/Linux**: `brew install --cask cc-switch`（tap: `farion1231/ccswitch`）
- **Windows**: GitHub Releases 下载

启动后点击 **"+"**，选择 MiniMax 作为 provider，输入 API key，所有模型名设为 `MiniMax-M3`，点击"启用"。`.claude.json` 仍需手动添加 `hasCompletedOnboarding` 字段。

---

## 启动与验证

1. 在目标目录运行 `claude`
2. 选择 **"Trust This Folder"**（仅首次）
3. 使用斜杠命令验证：
   - `/status` 应显示 base URL 指向 `api.minimaxi.com/anthropic`
   - `/model` 应显示 `MiniMax-M3` 为活跃模型

---

## 其他说明

- **Extended Thinking**：MiniMax-M3 默认启用，可通过 `Option+T`（macOS）或 `Alt+T`（Windows/Linux）切换，或通过 `/config` 配置
- **网络搜索**：需额外配置 [MCP 指南](https://platform.minimaxi.com/docs/token-plan/mcp-guide)
