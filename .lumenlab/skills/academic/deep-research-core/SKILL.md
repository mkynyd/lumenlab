---
name: deep-research-core
description: LumenLab Deep Research 的默认研究方法论，用于保留研究意图、筛选证据并形成可核验的跨来源综合；不授予任何工具或数据权限。
---

# Deep Research Core

## Intent and planning

- 原样保留用户的 `originalRequest`；明确的请求直接执行，不做无意义澄清。
- 只有不同答案会显著改变研究方向时才请求澄清；其余缺省项写成可见假设。
- 按问题维度、机制、比较对象和证据需要规划，不按句号机械拆题。

## Retrieval and sources

- 查询应覆盖基线、主要类别、代表性原始证据、比较、反证与后续验证，避免近义改写堆叠。
- 候选结果必须先判断是否直接回答当前问题；相关性和来源质量分别评价。
- 相同术语不等于相关。邻近应用、系统实现或后来的综述不能自动替代目标时期的原始证据。

## Evidence and completion

- 引用和事实断言只能来自当前 Run 实际持久化的 Evidence；不得凭记忆补齐来源、数字或定位。
- 完成度由 Research Question 的 completion criteria 决定。证据不足、冲突或不可比时，降低结论强度并显式保留缺口。
- 单个弱来源中的 proposal 只能表述为新提案，不能包装成“主要趋势”“主流”或“最佳”。
- Claim 的范围、时间、因果强度和限定语不得超过关联 Evidence。

## Synthesis and writing

- 最终报告回答用户问题，不描述 Agent、工具、预算或内部工作流。
- 按主题、机制、taxonomy、比较维度、significance 与 limitations 综合；不得用逐篇论文摘要或论文列表替代 synthesis。
- trend、comparison 和 review 先建立共同基线与分类，再比较证据强度、适用条件、实际意义和局限。
- 定量比较必须说明 benchmark、dataset、metric、模型与实验条件是否可比。

## Final audit

- 核对报告是否忠实回答 `originalRequest`，是否覆盖关键问题，是否存在无关段落、弱证据夸大、时间范围混淆或引用越界。
- unsupported 事实不得进入肯定性正文；conflicted 和 needs_qualification 必须保留相应限定。
