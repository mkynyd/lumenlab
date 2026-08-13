# LumenLab Agent 修复迭代方案（2026-08）

> 依据：docs/agent-audit-2026-08.md（审计报告）与其实施路线图
> 原则：每批修复带回归测试；通过 tsc / lint / 全量测试 / 生产构建后再提交；不部署（等待用户明确指示）

## 第一批（本轮执行）

| # | 任务 | 状态 |
|---|---|---|
| 1.1 | 落地页两处「凭注册码」→「邮箱注册即可使用」（hero-section.tsx、landing-footer.tsx） | ✅ 完成 |
| 1.2 | P0-1 token 用量逐轮累计：agent-loop 每轮 buffer 后累加 AdapterUsage，AgentLoopResult 新增 usage，accumulateAndSaveEvents 优先使用循环累计用量（含 durable checkpoint 合并） | ✅ 完成（+回归测试） |
| 1.3 | P0-2 真压缩：buildCompressedMessages 丢弃可压缩旧消息；compact 路由与 runtime 压缩路径落库标记 compressed-replaced；loadHistory 过滤已替换消息；createContextSummary 返回 id 供关联 | ✅ 完成（+回归测试） |
| 1.4 | P0-3 durable 审批恢复注入延续消息：checkpoint.pendingToolCall → 加载工具结果 → 在恢复的 prompt 前注入「已批准/失败/拒绝 + 结果摘要」 | ✅ 完成（+回归测试） |
| 1.5 | P0-4 非 durable 审批断头路：approve/reject 响应带 shouldContinue，客户端批准/拒绝后自动续跑一条延续消息 | ✅ 完成 |

## 第二批（本轮已实施，2026-08-14）

- 2.1a ✅ 关键词检索真实打分：候选窗口内按命中次数×词权重排序（完整词权重 3、中文二元组权重 1），修复文件序近随机问题（vector-store.ts searchChunksByKeyword）。
- 2.1b ✅ 向量腿缺失可见化：embedChunksForFile 返回嵌入统计，parse-job 写入 processingMetadata.embeddingStatus（missing/partial/complete），文件列表显示「索引不完整」徽标；混合检索无查询向量时输出降级 notice。
- 2.1c ✅ corpus-wide 预算化全文采样：按文件数分配预算，每份文件头/中/尾三段采样，替代只读 chunkIndex=0。
- 2.2 ✅ file.read 翻页：offset/nextOffset 支持分段读取长文档，工具 schema 同步暴露 offset。
- 2.3 ✅ P1-1/P1-2 租约生命周期：心跳续约失败重试 3 次（400ms 间隔）才判定丢失；空闲期周期回收过期租约；recoverExpired 将 in-flight 工具终态化为 TOOL_EXECUTION_OUTCOME_UNKNOWN 防重复副作用。
- 2.4 ✅ P1-3 工具统一硬超时：ToolMetadata.timeoutMs（默认 120s），超时信号与取消信号合并传入 handler，handler 抛错折叠为结构化失败（TOOL_TIMEOUT/HANDLER_THREW）。
- 2.5 ✅ P1-4 循环内工具结果统一 16k 截断；P1-7 Provider 4xx（除 429）fail-fast；P1-8 durable 取消/失败补终态占位消息。

## 第三批（待用户确认后开工）

- query rewrite / rerank；chunk heading 上下文注入；enhance/PATCH 后重嵌入与缓存刷新；SSE 工具执行事件时间线（tool_execution_start/update/end）；每对话单执行护栏；DSH 式事件日志改造评估；P2-4 审批等待 SSE 收敛；P2-6 审批偏好缓存 TTL。


## 交付与验收约定

- 每批：定向测试 + 全量测试 + tsc --noEmit + lint + 生产构建。
- 提交：main 干主线，英文 commit message（[类型]: 简述），完成后推送 origin/main。
- 部署：仅在用户明确要求时通过 scripts/deploy.sh 执行。
