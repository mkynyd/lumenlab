# Agent 模式

Agent 模式通过 Skill Router、统一 Runtime 和工具循环完成多步任务。模型可以读取资料、检索网页与论文、保存成果和导出 Word。

## 工具执行

1. Skill Router 根据任务选择指令，用户可手动切换或关闭 Skill。
2. 模型提出工具调用，服务端校验 Tool 注册信息、账号 scope、Skill 允许列表与风险上限、参数和资源归属。
3. 通过校验的调用自动执行，显式 `block` 或校验失败的调用被阻止。
4. 工具结果交回模型继续生成，过程区展示真实状态，来源保存在消息记录中。

保存成果、导出 DOCX 和已授权的资料删除同样通过校验后自动执行。请求中应明确操作对象和范围。Deep Research 的计划审阅、学习排程的保存确认各自遵循对应功能流程。

## 风险与恢复

风险 L0–L4 用于审计和 Skill 能力上限。L1 常见于检索与读取，L2 常见于成果保存与引用，L3 常见于资料删除与 DOCX 导出。当前没有默认开放的 L4 生产工具。

历史 `pending_approval` 任务在加载对话时自动恢复。兼容接口重新校验原始参数、当前权限和归属，并原子领取；已执行任务不会因重复恢复再次执行。

启用 `AGENT_DURABLE_EXECUTION_ENABLED=true` 时，任务使用租约 Worker、检查点和有序事件保存执行状态，支持查询、事件回放、取消与失败重试。Word 导出返回鉴权下载链接，二进制内容保留在下载链路内。

## 模型与来源

- 新普通会话默认使用 DeepSeek V4.1 Flash；MiniMax M3.1 也可选。Qwen 仅在服务端开放且账号具有相应凭据时可用。
- 三家模型通过 Responses 原生 Function Calling 接入同一 AgentLoop 和 ToolRunner，工具名由 Adapter 可逆编码，调用与结果按 call_id 配对。
- 图片、PDF/DOCX 聊天附件和项目资料走各自处理管线，详见[资料与 RAG](./files-and-rag.md)。
- 回答底部显示项目资料、网页和学术来源。Web 抓取受 allowlist、SSRF 校验、超时和大小限制。

## 常见问题

- 没有独立 Agent 入口时，可在聊天过程区查看工具状态。
- Skill 未激活时，先确认是否手动关闭、任务缺少资料或意图过于宽泛。
- 工具被阻止时，检查权限、Skill 能力范围、参数和操作对象。
- 历史任务无法恢复时，查看失败状态并重新发起明确请求，避免重复执行已经完成的操作。

开发者可继续阅读 [Policy Engine](../architecture/policy-engine.md)。
