# MiniMax 快速入门前置准备

> 来源: https://platform.minimaxi.com/docs/guides/quickstart-preparation

## Step 1: 账户注册/登录

调用 API 前需在 MiniMax 开放平台注册账户。企业团队可在页面底部找到操作说明。

## Step 2: 获取 Key

### 按量付费

通过控制台 Key 管理页面创建新 API Key。按量付费支持所有模态模型（语言、视频、语音、图像等）。

### Token Plan

在 Token Plan 管理页面获取订阅 Key。订阅 Key 用于 Token Plan 套餐和已购积分。

### 环境变量设置

**Anthropic API 兼容：**
```bash
export ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
export ANTHROPIC_API_KEY=${YOUR_API_KEY}
```

**OpenAI API 兼容：**
```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=${YOUR_API_KEY}
```

**AI SDK 兼容：**
```bash
export MINIMAX_API_KEY=${YOUR_API_KEY}
```

## Step 3: 添加资源

- 按量付费用户：通过余额页面充值
- Token Plan 用户：购买订阅或积分，或使用团队分配的资源

---

## 企业团队注册

推荐使用「主账号+子账号」结构：

1. 在 MiniMax 开放平台注册账户（成为主账号，注册姓名和手机作为企业管理员信息）
2. 登录主账号，通过子账号管理页面创建子账号（无数量限制）
3. 将子账号分发给团队成员使用

**子账号权限：**
- 与主账号共享使用权限和速率限制，API 用量共享计费
- 子账号无法查看或管理支付相关功能
