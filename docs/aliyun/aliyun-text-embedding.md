# 阿里云百炼 Embedding API 文档

> 来源：https://help.aliyun.com/zh/model-studio/embedding
> 最后更新：2026-06-28

---

## 一、核心 Endpoint

### OpenAI 兼容接口

| 地域 | Endpoint |
|---|---|
| 华北2（北京） | `https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings` |

### DashScope 原生接口

| 地域 | Endpoint |
|---|---|
| 华北2（北京） | `https://dashscope.aliyuncs.com/api/v1/services/embeddings/multi-modal-embedding/multi-modal-embedding` |

本项目使用 DashScope Node.js SDK 原生接口调用 `qwen3-vl-embedding` 多模态融合 Embedding。

---

## 二、多模态融合向量模型

| 模型 | 维度 | 单条最大 Token | 单价 (元/千Token) | 能力 |
|---|---|---|---|---|
| **qwen3-vl-embedding** | 1024/768/512/256/128/64 | 8,192 | ¥0.0005 | 文本 + 图片 + 视频融合向量 |

### 模型特点

- 基于 Qwen3-VL 的多模态统一 Embedding 模型。
- 支持 `enable_fusion: true` 对文本、图片、视频进行融合表示。
- 默认维度 1024，创建向量数据库时维度必须与此一致。
- 适合 RAG 场景中的文档切块与查询融合召回。

---

## 三、认证方式

```
Authorization: Bearer <DASHSCOPE_API_KEY>
```

API Key 获取：https://help.aliyun.com/zh/model-studio/get-api-key

---

## 四、调用示例

### Node.js（DashScope SDK，本项目使用）

```typescript
import { Configuration, DashscopeApi } from "dashscope-sdk-official";

const api = new DashscopeApi(new Configuration({ apiKey: process.env.DASHSCOPE_API_KEY }));

const result = await api.createMultiModalEmbedding({
  model: "qwen3-vl-embedding",
  input: [{ text: "文本内容" }],
  enable_fusion: true,
  dimension: 1024,
});

if (result.status_code !== 200 || !result.output?.embeddings) {
  throw new Error(`Embedding failed: ${result.code ?? "unknown"} ${result.message ?? ""}`);
}

const embedding = result.output.embeddings[0].embedding;
```

### 多模态输入（文本 + 图片 + 视频）

```typescript
const result = await api.createMultiModalEmbedding({
  model: "qwen3-vl-embedding",
  input: [
    { text: "请描述下图中的实验装置" },
    { image: "https://example.com/experiment.jpg" },
    { video: "https://example.com/experiment.mp4" },
  ],
  enable_fusion: true,
  dimension: 1024,
});
```

输入项支持 `text`、`image`（图片 URL 或 base64）和 `video`（视频 URL）。开启 `enable_fusion: true` 后，模型会对多种模态进行统一融合，生成单一向量。

### 批量文本向量化

```typescript
const texts = ["文本一", "文本二", "文本三"];

const result = await api.createMultiModalEmbedding({
  model: "qwen3-vl-embedding",
  input: texts.map((text) => ({ text })),
  enable_fusion: true,
  dimension: 1024,
});

const vectors = result.output.embeddings
  .slice()
  .sort((a, b) => (a.text_index ?? 0) - (b.text_index ?? 0))
  .map((item) => item.embedding);
```

批量建议每次 ≤ 10 条。

---

## 五、返回格式

```json
{
  "status_code": 200,
  "request_id": "f62c2ae7-0906-9758-ab34-47c5764f07e2",
  "output": {
    "embeddings": [
      {
        "text_index": 0,
        "embedding": [0.0023064255, -0.009327292, "...", -0.0028842222]
      }
    ]
  },
  "usage": {
    "input_tokens": 23
  }
}
```

---

## 六、注意事项

1. **维度匹配**：创建向量数据库时维度必须与 `dimension` 参数一致，本项目使用 1024 维。
2. **Token 上限**：单文本不超过 8,192 Token，批量建议 ≤ 10 条。
3. **API Key 安全**：使用环境变量，不要硬编码。
4. **多模态融合**：`enable_fusion: true` 用于文本与图片/视频联合 Embedding；纯文本检索可不开启。
5. **仅北京地域**：`dashscope.aliyuncs.com` 对应华北2（北京）。
