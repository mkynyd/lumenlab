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

## 第二批（待用户确认后开工）

- 2.1 RAG 地基：关键词检索真实打分（BM25/tsvector 或命中数+位置加权）；向量腿缺失可见化（文件状态/警告 + 检索降级提示）；corpus-wide 预算化全文采样（替代 chunkIndex=0）。
- 2.2 file.read 增加 offset/limit（翻页）；页码锚点补全（parser → block → chunk → 来源面板）。
- 2.3 P1-1/P1-2 租约生命周期：recoverExpired 进每轮 drain、心跳失败重试 N 次；in-flight 工具按 TOOL_EXECUTION_OUTCOME_UNKNOWN 终态化防重复执行。
- 2.4 P1-3 工具统一超时（tool-runner 外层 deadline）+ run 整体超时 + 断连 N 分钟自动软停止。
- 2.5 P1-4 循环内工具结果统一截断；P1-7 Provider 4xx fail-fast；P1-8 终态占位消息。

## 第三批

- query rewrite / rerank；chunk heading 上下文注入；enhance/PATCH 后重嵌入与缓存刷新；SSE 工具执行事件时间线（tool_execution_start/update/end）；每对话单执行护栏；DSH 式事件日志改造评估。

## 交付与验收约定

- 每批：定向测试 + 全量测试 + tsc --noEmit + lint + 生产构建。
- 提交：main 干主线，英文 commit message（[类型]: 简述），完成后推送 origin/main。
- 部署：仅在用户明确要求时通过 scripts/deploy.sh 执行。
