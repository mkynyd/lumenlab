# MiniMax Token Plan MCP（网络搜索）

> 来源: https://platform.minimaxi.com/docs/token-plan/mcp-guide

Token Plan MCP 提供 **web_search** 工具，帮助开发者在编码过程中快速获取信息。

> 推荐使用 [MiniMax CLI](/token-plan/minimax-cli) 替代 MCP，配置更简单、使用更高效。

---

## 工具说明

### web_search

| 参数 | 类型 | 必需 | 说明 |
|------|------|:--:|------|
| query | string | ✓ | 搜索查询词 |

---

## 前置准备

### 1. 获取 API Key

在订阅管理 > Token Plan 查看订阅 Key。该 Key 需拥有 Token Plan 席位或已购积分权限。

### 2. 安装 uvx

**macOS / Linux：**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Windows：**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 3. 验证安装

```bash
which uvx  # macOS/Linux
# 或
(Get-Command uvx).source  # Windows
```

若正确安装，会显示路径（如 `/usr/local/bin/uvx`）。若报错 `spawn uvx ENOENT`，需配置绝对路径。

---

## 在 Claude Code 中使用

### 一键安装
```bash
claude mcp add -s user MiniMax \
  --env MINIMAX_API_KEY=api_key \
  --env MINIMAX_API_HOST=https://api.minimaxi.com \
  -- uvx minimax-coding-plan-mcp -y
```

### 手动配置
编辑 `~/.claude.json`：
```json
{
  "mcpServers": {
    "MiniMax": {
      "command": "uvx",
      "args": ["minimax-coding-plan-mcp", "-y"],
      "env": {
        "MINIMAX_API_KEY": "MINIMAX_API_KEY",
        "MINIMAX_API_HOST": "https://api.minimaxi.com"
      }
    }
  }
}
```

### 验证配置
进入 Claude Code 后输入 `/mcp`，能看到 `web_search` 即配置成功。

---

## 在 Cursor 中使用

前往 `Cursor → Preferences → Cursor Settings → Tools & Integrations → MCP → Add Custom MCP`，在 `mcp.json` 中添加：

```json
{
  "mcpServers": {
    "MiniMax": {
      "command": "uvx",
      "args": ["minimax-coding-plan-mcp"],
      "env": {
        "MINIMAX_API_KEY": "填写你的 API Key",
        "MINIMAX_MCP_BASE_PATH": "本地输出目录路径，需保证路径存在且有写入权限",
        "MINIMAX_API_HOST": "https://api.minimaxi.com",
        "MINIMAX_API_RESOURCE_MODE": "可选，资源提供方式：url 或 local，默认 url"
      }
    }
  }
}
```

---

## 在 OpenCode 中使用

编辑 `~/.config/opencode/opencode.json`：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "MiniMax": {
      "type": "local",
      "command": ["uvx", "minimax-coding-plan-mcp", "-y"],
      "environment": {
        "MINIMAX_API_KEY": "MINIMAX_API_KEY",
        "MINIMAX_API_HOST": "https://api.minimaxi.com"
      },
      "enabled": true
    }
  }
}
```

进入 OpenCode 后输入 `/mcp`，看到 `MiniMax connected` 即配置成功。
