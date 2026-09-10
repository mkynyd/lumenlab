# DeepSeek 模型与价格

> 来源：api-docs.deepseek.com 更新日志（2026-09-10）与「Models & Pricing」。本文件是厂商资料副本，不是 LumenLab 的运行合同；实际接入以当前源码为准。
>
> 最后同步：2026-09-10

## 当前接入说明

- 请求使用官方模型 ID `deepseek-flash`（DeepSeek-V4.1-Flash），不再使用 `claude-*` 兼容别名。
- Anthropic 兼容接口使用 `https://api.deepseek.com/anthropic`；Responses API 使用 `https://api.deepseek.com`。
- 平台内部模型 ID 与 wire ID 同为 `deepseek-flash`；历史 ID 见下节，只用于历史消息与历史账单展示。
- 平台侧计费权重见 `src/lib/tokens/credits.ts`，峰谷档按请求开始时间（Asia/Shanghai）冻结。

## 2026-09-10 变更摘要

- 发布 **DeepSeek-V4.1-Flash**：新架构家族的轻量模型，原生多模态视觉理解；官方称其在性能、成本、速度和总耗时上全面超过 V4 Pro。
- 调用名改为 `deepseek-flash`。**V4 Flash 与 V4 Flash Vision Exp 已下线**，为兼容，`deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 暂时路由到 V4.1 Flash 并按 Flash 价格计费。
- V4 Pro 计划有序下线：自北京时间 2026-09-14 12:00 起、直至 V4.1 Pro 发布前，所有 `deepseek-v4-pro` 请求同样路由到 V4.1 Flash 并按 Flash 价格计费。
- 价格同步下调，高峰价为低谷价的两倍。

## DeepSeek-V4.1-Flash

- **模型名**：`deepseek-flash`
- **上下文长度**：1M tokens
- **最大输出**：384K tokens
- **思考模式**：支持非思考与思考模式，默认开启
- **图像理解**：支持（原生多模态）
- **并发限制**：2,500 个请求

### 价格（每百万 tokens，人民币）

| 类型 | 空闲时段 | 高峰时段 |
|------|---------|---------|
| 输入（缓存命中） | ¥0.02 | ¥0.04 |
| 输入（缓存未命中） | ¥1.00 | ¥2.00 |
| 输出 | ¥4.00 | ¥8.00 |

高峰时段为 UTC 周一至周五 01:00-04:00 与 06:00-10:00，即 Asia/Shanghai 周一至周五 09:00-12:00 与 14:00-18:00；其余时间（含周末全天）为低谷。低谷价为高峰价的一半。

## 历史模型

| 模型名 | 状态 | 说明 |
|--------|------|------|
| `deepseek-v4-flash-vision-exp` | 已下线 | 2026-08-21 发布的视觉实验模型，请求已由 V4.1 Flash 接管 |
| `deepseek-v4-flash` | 已下线 | 2026-07-31 GA 的 V4 Flash，请求已由 V4.1 Flash 接管 |
| `deepseek-v4-pro` | 计划下线 | 2026-09-14 12:00（北京时间）起请求路由到 V4.1 Flash |

历史模型在 LumenLab 的对应价格（元/百万 tokens）保持结算时的规则，不按新价重算：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
|------|---------|-----------|------|
| `deepseek-v4-flash` | 0.02 | 1.00 | 2.00 |
| `deepseek-v4-flash-vision-exp`（低谷 / 高峰） | 0.05 / 0.10 | 1.50 / 3.00 | 4.50 / 9.00 |
| `deepseek-v4-pro` | 0.025 | 3.00 | 6.00 |

## 功能支持矩阵

| 功能 | V4.1-Flash |
|------|-----------|
| JSON Output | 支持 |
| Tool Calls | 支持 |
| Responses API | 支持 |
| Anthropic API | 支持 |
| Chat Prefix Completion (Beta) | 支持 |
| FIM Completion (Beta) | 仅非思考模式 |
| Vision | 支持 |

## 计费说明

- Token 消耗量 × 模型单价 = 费用
- `usage` 对象中返回实际消耗 token 数
- 所有模型支持上下文缓存（KV Cache），缓存命中享受更低价格
