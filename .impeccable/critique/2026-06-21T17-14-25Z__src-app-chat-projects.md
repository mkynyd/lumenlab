---
target: 项目模块全量
total_score: 28
p0_count: 2
p1_count: 3
timestamp: 2026-06-21T17-14-25Z
slug: src-app-chat-projects
---
# Project Workspace Impeccable Critique (复评)

> Target: `src/app/(chat)/projects` — 项目列表 + 新建 + 详情 + 侧边栏组件
> 对比昨日: 25/40

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | 骨架加载、解析状态、流式渲染、错误提示全覆盖，无死角。 |
| 2 | Match Between System and Real World | 4 | 学生领域术语清晰，中文语境自然，"实验工作台/资料复习/代码项目"分类符合预期。 |
| 3 | User Control and Freedom | 3 | 取消/关闭/清除选择到位；删除操作无撤销或回收站。 |
| 4 | Consistency and Standards | 2 | 所有交互元素 focus-visible 被全局禁用（outline-style: none，无替代方案），违反 WCAG 2.4.7。按钮样式两套体系并存（shadcn variant + CSS 自定义变量 `--color-project-control`）。iconoir 与 lucide 图标混用。 |
| 5 | Error Prevention | 3 | 删除双重确认措辞优秀，文件类型/大小限制到位。新建项目表单无草稿保存，意外离开丢失全部输入。 |
| 6 | Recognition Rather Than Recall | 3 | 图标按钮有 tooltip，选中文件数量在上下文提示中可见。无文件搜索/过滤，25 个文件时只能滚动查找。无对话搜索。 |
| 7 | Flexibility and Efficiency | 3 | 批量操作、Shift+click 范围选择、右键菜单扎实。无键盘快捷键（新建对话、侧栏切换均需鼠标）。无最近使用列表。 |
| 8 | Aesthetic and Minimalist Design | 2 | 项目详情页 6 个功能区同时呈现，视觉密度偏高。4 按钮承载 8 个操作（"更多"下拉含 4 项）。 |
| 9 | Error Recovery | 3 | 上传错误显示具体文件名，失败文件可重解析，解析期间消息排队。删除操作无撤销。 |
| 10 | Help and Documentation | 1 | 无应用内帮助、无功能说明、无文档入口。仅两行上下文提示作为引导。 |
| **Total** | | **28/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment**: 不是一眼 AI 生成的产品。克制、一致的视觉系统，扁平状态变化，无装饰性边框/阴影。但三个模式值得警惕：

1. **双侧栏冲突** — 明确命中 PRODUCT.md 的 "避免重复侧边栏" 禁令。主应用侧栏（聊天/项目/转换导航）与项目文件侧栏在项目详情页同时展开，争夺同一个水平空间。"新建项目"按钮在两个侧栏中重复出现。

2. **小型大写追踪标签** — 项目卡片的 `text-[10px] font-mono uppercase tracking-wider` 类型标签（"实验工作台""资料复习"）命中 "Tiny uppercase tracked eyebrow" 禁令。

3. **backdrop-blur 三处使用** — `chat-input.tsx`、项目详情页、侧栏的同款模糊，三处出现已形成模式。

**Deterministic scan**: CLI 扫描 exit code 0，零发现。detect.js 浏览器注入跳过（文件不存在于端点）。

**Visual overlays**: detect.js 文件在 `localhost:3000/detect.js` 端点和技能脚本目录中均不存在（仅有 `detect-antipatterns-browser.js` 5139 行源文件），URL 注入跳过。变异预检在三个页面均成功。无用户可见覆盖层可用。

**交叉验证**:
- 双方一致: 颜色对比度全部通过 WCAG AA（B 提供具体 lab() 数值验证）
- 双方一致: 390px 无水平溢出
- 评估 B 发现但 A 遗漏: 全局 focus-visible 被禁用 — 44 个交互元素 outline-style: none，无替代焦点样式
- 评估 A 发现但 B 未覆盖: 侧栏重复、无帮助文档、表单无草稿保存

## Overall Impression

项目的色彩工作已经到位，生产环境可用。今天最大的发现是焦点指示器被全局移除但没有提供替代方案——这是一个可访问性的硬伤，需要立即修复。双侧栏架构是结构性问题，但修复成本高；焦点指示器是 CSS 级的一行修复，影响面广。

## What's Working

1. **空/加载/错误状态覆盖完整**: 每个状态槽位一致。项目列表脉动骨架（非 spinner）、项目详情 LoadingIndicator、空状态引导 CTA、错误消息可关闭且具体。
2. **批量文件操作扎实**: Shift+click 范围选择 + 全选/取消全选 + 批量删除/重解析/下载/分类 + 右键菜单 + 解析失败过滤。
3. **删除确认措辞出色**: "文件内容、解析结果和索引记录将无法恢复""相关文件和对话将被一并删除"。
4. **颜色对比度全部达标**: body 文本、主按钮、次要文本、侧栏标签等全部通过 WCAG AA（4.5:1），部分达 14:1。

## Priority Issues

### [P0] 全局焦点指示器缺失 — WCAG 违规
- **Why it matters**: WCAG 2.4.7 Focus Visible (Level AA) 要求所有键盘可操作元素必须有可见焦点指示器。键盘用户等同于无法使用。
- **Fix**: 为 `:focus-visible` 添加替代焦点样式——背景色偏移或微妙的 ring-offset。这是一行 CSS 的修复。

### [P0] 双侧栏冲突 — 布局结构问题
- **Why it matters**: 认知负荷、视觉噪音、功能重复。用户需理解两个独立的展开/折叠系统。
- **Fix**: 进入项目详情页时自动折叠主导航侧栏，或将文件侧栏提升为主侧栏内的选项卡面板。

### [P1] 新建项目表单无草稿保护
- **Why it matters**: 自定义快捷任务需逐一填写，意外离开全部丢失。
- **Fix**: localStorage 暂存 + beforeunload 拦截。

### [P1] 模型选择器标签对用户不透明
- **Why it matters**: "快速/高级"实际映射 provider + reasoning effort，用户不理解选择内容。
- **Fix**: 分离推理深度与提供方选择。

### [P1] 文件工具栏 4 按钮承载 8 操作
- **Why it matters**: 垂直空间浪费，"重新分类"常被禁用却占据显眼位置。
- **Fix**: 将"重新分类"移入"更多"菜单；使用可折叠批量操作条。

### [P2] 无文件/对话搜索或过滤
- **Why it matters**: 25 个文件时只能滚动查找。
- **Fix**: 文件侧栏顶部添加文本过滤输入。

### [P2] 项目详情页认知密度偏高
- **Why it matters**: 6 个功能区同时呈现，聊天区域占比偏小。
- **Fix**: 合并顶栏，默认折叠快捷任务栏，文件/对话添加标签页。

## Persona Red Flags

**Alex (Power User)**: 无键盘快捷键；模型选择器每次 3 次点击；无最近使用项目。

**Jordan (First-Timer)**: 空项目无"第一步"引导；文件选择与消息发送的因果关系不明确。

**Sam (Accessibility)**: 焦点指示器全局缺失 — 阻塞级；FileContentDialog 无焦点陷阱。

## Minor Observations

- 自定义快捷任务命名截取前 6 个无空格字符，几乎无法产生可读按钮文本
- file-content-dialog.tsx 未使用 shadcn Dialog 组件
- 上下文提示不区分"已选"与"可用"（解析失败的文件 AI 无法使用）
- 模型选择器条件渲染可能在加载中产生空白
- 项目列表两套删除确认流存在冗余
- 对话标题统一为"快捷任务: XXX"，无法区分手动/快捷任务

## Questions to Consider

1. 进入项目详情页自动折叠主导航侧栏是否会大幅提升空间专注感？
2. 自定义快捷任务的 slice(0,6) 命名规则是真实路径还是原型残留？
3. 是否需要区分"已选"和"可用"（解析失败的文件 AI 不可用）？
4. 用户是否需要区分手动输入与快捷任务生成的对话？
