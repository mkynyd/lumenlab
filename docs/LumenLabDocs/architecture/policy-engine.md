# Policy Engine

工具通过服务端校验后自动执行。风险等级 L0–L4 保留用于审计和 Skill 能力上限，不再强制用户点击审批；显式 `block` 始终拒绝。

## 决策流程

1. 校验 Tool 已注册。
2. 从数据库读取用户 scopes，要求满足 Tool 与 Skill 的全部权限；空权限不回退。
3. 拒绝 Workspace 显式禁用的 Tool 或 Skill。
4. 检查 Skill 工具允许列表与风险上限。
5. 检查参数引用的项目、资料归属。
6. 校验必填参数与类型。
7. 拒绝 Tool、Skill 或用户偏好中的显式 `block`；历史 ask_first/ask_each 不再暂停任务。
8. 返回 `allow / AUTO_APPROVED_BY_POLICY`，由 ToolRunner 执行 handler、持久化并审计。

## 执行与恢复

正常工具路径为 `tool_proposed → tool_started → tool_completed / tool_failed`，无需审批 token。文档保存、导出和其他已授权工具使用同一条链路，取消和幂等约束继续生效。

历史 `pending_approval` 卡片加载后由聊天自动调用旧批准 API。API 仍验证登录、执行归属、原始参数、当前权限和 pending 状态，再原子领取工具；并发或已完成请求不重复执行。持久执行继续原任务，保留原生工具消息结构。旧批准/拒绝 API 与事件类型保留兼容，常规界面不再显示审批按钮。

## Word 下载

`artifact.export_docx` 复用共享 Word 渲染器和鉴权下载接口，返回小型 downloadUrl 引用。DOCX 字节及嵌入字体不进入模型上下文、执行 checkpoint 或公共事件；每次下载重新验证成果归属。
