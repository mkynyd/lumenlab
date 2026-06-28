# 阿里云百炼 多模态向量化 API 文档

> 来源：https://help.aliyun.com/zh/model-studio/embedding
> 最后更新：2026-06-16

---

## 一、Endpoint

```
POST https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding
```

> 仅华北2（北京）区域。注意：**不走 OpenAI 兼容接口**，必须用 DashScope 原生接口。

---

## 二、多模态向量模型

| 模型 | 维度 | 文本上限 | 图片限制 | 特性 |
|---|---|---|---|---|
| **qwen3-vl-embedding** | 2560/2048/1536/1024(默认)/768/512/256 | 32,000 Token | ≤5张，单张≤5MB | 融合向量+独立向量，33语种 |
| qwen2.5-vl-embedding | 2048/1024(默认)/768/512 | — | ≤5MB | 仅融合向量，11语种 |
| tongyi-embedding-vision-plus-2026-03-06 | 1152(默认)/1024/512/256/128/64 | 1,024 Token | ≤64张，单张≤10MB | 融合+独立，30+语种 |
| tongyi-embedding-vision-flash-2026-03-06 | 768(默认)/512/256/128/64 | 1,024 Token | ≤64张，单张≤10MB | 轻量版，速度快 |
| multimodal-embedding-v1 (旧版) | 1024 | 512 Token | ≤8张，单张≤3MB | 独立向量 |

### 推荐

- **通用场景**：`qwen3-vl-embedding`（最新、最强、支持融合）
- **批量/轻量**：`tongyi-embedding-vision-flash-2026-03-06`
- **海量图片**：`tongyi-embedding-vision-plus-2026-03-06`（最多 64 张）

---

## 三、关键概念

| 概念 | 说明 |
|---|---|
| **融合向量** (Fusion) | 文本+图片+视频融合为一个向量，实现"以文搜图"、"以图搜文" |
| **独立向量** (Independent) | 各模态分别生成向量，用于独立检索 |
| `enable_fusion` | qwen3-vl-embedding 专有参数，`true` 时返回融合向量 |

---

## 四、调用示例

### 独立向量模式（tongyi-embedding-vision-plus）

```bash
curl --location --request POST \
  'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding' \
  --header "Authorization: Bearer $DASHSCOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "tongyi-embedding-vision-plus",
    "input": {
      "contents": [
        {"text": "多模态向量模型"},
        {"image": "https://example.com/image.jpg"},
        {"video": "https://example.com/video.mp4"},
        {"multi_images": ["https://example.com/img1.png", "https://example.com/img2.png"]}
      ]
    }
  }'
```

### 融合向量模式（qwen3-vl-embedding）

```bash
curl --location \
  'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding' \
  --header "Authorization: Bearer $DASHSCOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "qwen3-vl-embedding",
    "input": {
      "contents": [
        {"text": "商品描述文本"},
        {"image": "https://example.com/product.jpg"},
        {"image": "https://example.com/detail.jpg"}
      ]
    },
    "parameters": {
      "enable_fusion": true,
      "dimension": 1024
    }
  }'
```

### Python SDK

```python
import dashscope
from http import HTTPStatus

# 独立向量
resp = dashscope.MultiModalEmbedding.call(
    model="tongyi-embedding-vision-plus",
    input={
        "contents": [
            {"text": "查询文本"},
            {"image": "https://example.com/img.jpg"}
        ]
    }
)

# 融合向量
resp = dashscope.MultiModalEmbedding.call(
    model="qwen3-vl-embedding",
    input={
        "contents": [
            {"text": "文本"},
            {"image": "https://example.com/img.jpg"}
        ]
    },
    enable_fusion=True,
    dimension=1024
)

if resp.status_code == HTTPStatus.OK:
    embeddings = resp.output["embeddings"]
```

---

## 五、参数汇总

| 参数 | 说明 |
|---|---|
| `model` | 模型名称（必选） |
| `input.contents` | 多模态输入列表，支持 `text`/`image`/`video`/`multi_images` |
| `parameters.dimension` | 输出维度（仅 qwen3-vl-embedding 和 tongyi-embedding-vision 新版支持） |
| `parameters.enable_fusion` | 是否启用融合向量（仅 qwen3-vl-embedding 支持） |
| `parameters.fps` | 视频帧率控制，[0, 1]，默认 1.0 |
| `parameters.instruct` | 任务指令，可提升 1%-5% 效果 |

## 六、支持的图片格式

| 模型系列 | 支持格式 |
|---|---|
| qwen3-vl-embedding / qwen2.5-vl-embedding | JPEG, PNG, WEBP, BMP, TIFF, ICO, DIB, ICNS, SGI |
| tongyi-embedding-vision 系列 | JPG, PNG, BMP |

图片输入支持 URL 或 Base64 编码。

---

## 七、与文本 Embedding 的关系

| | 文本 Embedding (v4/v3) | 多模态 Embedding |
|---|---|---|
| **接口** | OpenAI 兼容 | DashScope 原生 |
| **用途** | 纯文本向量化 | 图文视频混合向量化 |
| **本项目的用途** | 课件内容 chunk 向量化 | 未来：课件中图片/图表的语义检索 |

> 本项目已使用 qwen3-vl-embedding 1024 维融合模式，支持文本、图片与视频联合 Embedding。
