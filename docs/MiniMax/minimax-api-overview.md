# MiniMax API 概览

> 来源: https://platform.minimaxi.com/docs/api-reference/api-overview

## API Key 获取

MiniMax 提供两种付费模式：

- **按量付费 (Pay-as-you-go)**：通过控制台 Key 管理页面创建 API Key，支持所有模态模型（语言、视频、语音、图像等）
- **Token Plan**：订阅制 Key，在订阅管理中获取，与按量计费 API Key 相互独立

## 语言模型

| 模型 | 上下文窗口 | 说明 |
|------|-----------|------|
| MiniMax-M3 | 1,000,000 tokens | Agent 推理、工具调用、代码和长上下文任务，支持多模态输入 |
| MiniMax-M2.7 | 204,800 tokens | 开启自我迭代，~60 TPS |
| MiniMax-M2.7-highspeed | 204,800 tokens | M2.7 高速版，~100 TPS |
| MiniMax-M2.5 | 204,800 tokens | 高性能与性价比，~60 TPS |
| MiniMax-M2.5-highspeed | 204,800 tokens | M2.5 高速版，~100 TPS |
| MiniMax-M2.1 | 204,800 tokens | 强大多语言编程，~60 TPS |
| MiniMax-M2.1-highspeed | 204,800 tokens | M2.1 高速版，~100 TPS |
| MiniMax-M2 | 204,800 tokens | 高效编码与 Agent 工作流 |

接入方式：HTTP、**Anthropic SDK**（推荐）、OpenAI SDK

## 同步语音合成 (T2A)

- 无状态 API，单次最大 10,000 字符
- 6 个模型：`speech-2.8-hd` 到 `speech-02-turbo`
- 300+ 系统音色、克隆音色、音量/语速/音调控制
- 支持混合音频、间隔时间、多种输出格式（mp3, pcm, flac, wav）
- 40 种语言支持
- HTTP 和 WebSocket 两种端点

## 异步长文本 TTS

- 单次最大 **100 万字符**
- 目标场景：整本书籍等长文本语音生成
- 返回句子级时间戳
- 生成 URL 有效期 **9 小时**
- 工作流：创建任务 → 轮询状态 → 通过 File API 获取

## 音色克隆

- 需要个人或企业认证
- 上传克隆音频 → 可选上传示例音频 → 调用克隆端点
- 克隆音色临时存储，**168 小时（7 天）**后删除（除非用于 T2A 合成调用）
- 计费发生在首次合成使用时，而非克隆时

## 音色设计

- 通过文本描述生成自定义音色
- 同样 168 小时保留规则
- 推荐使用 `speech-02-hd` 获得最佳效果

## 视频生成

- 三个模型：**Hailuo-2.3**（改进动作/物理）、**Hailuo-2.3-Fast**（图生视频，更快更便宜）、**Hailuo-02**（1080p，最长 10s，更强指令遵循）
- 全异步：创建 → 轮询 → 下载
- 支持文生视频和图生视频

## 图片生成

- `image-01`：文生图和参考图生图
- `image-01-live`：增加风格控制

## 音乐生成

- 单一模型 **music-2.6**，通过 prompt 和歌词生成有声音乐

## 文件管理

- 5 个操作：上传、列出、检索、下载、删除
- 支持格式：文档（pdf, docx, txt, jsonl）和音频（mp3, m4a, wav）
- 总存储上限 **100GB**，单文件上限 **512MB**

## 错误码

常见错误码使用 HTTP 状态码体系：
- `1000`：未知错误
- `1001`：请求超时
- `1002`：速率限制触发
- `1004`：认证失败
- `1008`：余额不足
- `1013`：内部服务器错误
- `1027`：输出内容错误
- `1039`：Token 超限
- `2013`：参数错误

## 其他资源

- 官方 MCP server 实现（Python 和 JavaScript）在 GitHub
- 语音调试控制台用于 TTS 和音色克隆实验
