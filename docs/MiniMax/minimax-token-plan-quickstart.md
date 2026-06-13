# MiniMax Token Plan 快速接入

> 来源: https://platform.minimaxi.com/docs/token-plan/quickstart

## 开始使用

### Step 1: 获取订阅 Key

在订阅管理页面获取订阅 Key。

> **警告**：订阅 Key 用于 Token Plan 订阅套餐和已购积分，与按量计费 API Key 不可互换。

### Step 2: 获得资源

- 购买个人 Plus、Max 或 Ultra Token Plan 订阅
- 购买积分包
- 使用团队 Owner/Admin 分配的资源

### Step 3: 测试 API 调用（可选）

**安装 SDK：**
```bash
pip install anthropic
```
```bash
npm install @anthropic-ai/sdk
```

**配置环境变量：**
```bash
export ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
export ANTHROPIC_API_KEY=${YOUR_API_KEY}
```

**测试调用（Python）：**
```python
import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
    model="MiniMax-M3",
    max_tokens=1000,
    system="You are a helpful assistant.",
    messages=[
        {"role": "user", "content": [{"type": "text", "text": "Hi, how are you?"}]}
    ]
)

for block in message.content:
    if block.type == "thinking":
        print(f"Thinking:\n{block.thinking}\n")
    elif block.type == "text":
        print(f"Text:\n{block.text}\n")
```

### Step 4: 接入 AI 编程工具

支持的 AI 编程工具：
- **Claude Code**
- Cursor
- Trae
- OpenCode
- Kilo Code
- Grok CLI
- Codex CLI
- Droid

每个工具都有专属设置页面。

---

## 接入 MCP

配置网络搜索功能参考 Token Plan MCP 指南。

## 了解更多

- Token Plan 定价
- 常见问题（使用、计费、切换、退款）

## 最佳实践

- M 系列模型使用技巧
- Mini Agent（使用 M 系列模型构建 Agent）
