# MiniMax CLI

> 来源: https://platform.minimaxi.com/docs/token-plan/minimax-cli

CLI 工具（github.com/MiniMax-AI/cli）让 Token Plan 用户直接在 AI 助手（如 OpenClaw、Claude Code）中访问 MiniMax 的多模态能力 —— 视频生成、语音合成、音乐创作和编码。

---

## 安装与配置

### 方式一：通过 AI Agent

将以下 prompt 粘贴到 AI Agent（OpenClaw、Claude Code、Cursor 等），替换 `sk-xxxxx` 为实际 key：

```
1. npm install -g mmx-cli，用 mmx --version 验证
2. mmx auth login --api-key sk-xxxxx
3. npx skills add MiniMax-AI/cli -y -g
4. mmx quota 检查 Token Plan 余额
```

### 方式二：手动安装

**1. 安装 MMX-CLI：**
```bash
npm install -g mmx-cli
```

**2. 使用 API Key 登录：**
```bash
mmx auth login --api-key sk-xxxxx
```

CLI 会自动根据 key 检测服务区域：`cn`（国内 `platform.minimaxi.com`）或 `global`（国际 `platform.minimax.io`）。

若登录后调用报 401，大概率是 region 未自动匹配，手动设置：
```bash
mmx config set --key region --value cn   # 国内
mmx config set --key region --value global  # 国际
```

用 `mmx auth status` 确认。

**3. 安装 SKILL（可选，Agent 用户推荐）：**
```bash
npx skills add MiniMax-AI/cli -y -g
```

---

## 使用

### 通过 Agent

示例：
- 文本：`帮我用minimax生成一首关于AI的4言诗`
- 视频（Hailuo 2.3）：日落时窗边的猫
- 音乐（Music 2.6）：夏日海边的 Bossa Nova
- 语音（Speech 2.8）：温柔女声欢迎词
- 图片（Image 01）：赛博朋克城市夜景 16:9

生成文件保存在 `minimax-output/` 目录。

### CLI 命令

| 能力 | 命令 | 说明 |
|------|------|------|
| 文本 | `mmx text chat --message "..."` | 多轮对话、流式、系统提示词、JSON 输出 |
| 图片 | `mmx image generate` 或 `mmx image "..."` | 文生图，支持宽高比和批量 |
| 视频 | `mmx video generate --prompt "..."` | 异步视频生成 |
| 语音 | `mmx speech synthesize --text "..." --out file.mp3` | TTS，多音色+流式 |
| 音乐 | `mmx music generate --prompt "..." --out file.mp3` | 文生音乐，支持歌词和纯器乐 |
| 视觉 | `mmx vision describe` | 图片理解（本地文件、URL、文件 ID） |
| 搜索 | `mmx search query` | 内置网络搜索 |

运行 `mmx`（无参数）打开交互式 CLI 面板。

---

## 运维命令

| 命令 | 用途 |
|------|------|
| `mmx auth status / refresh / logout` | 身份检查、凭据刷新、退出 |
| `mmx config show / set` | 查看/修改配置（region, 默认模型等） |
| `mmx quota` | Token Plan 用量和剩余额度 |
| `mmx update / mmx update latest` | 检查更新或升级到最新版 |

---

## FAQ

**API Key 在哪获取？**
- 国内：platform.minimaxi.com → 订阅 Token Plan
- 国际：platform.minimax.io → 订阅 Token Plan

**401 错误？** CLI 通常自动检测 region。避免在国内方案中使用 VPN。手动设置 `mmx config set --key region --value cn` 或 `global`。
