<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Agent 行为约束

## 开始工作前

**每次开始构建或修改此项目之前**，必须首先阅读仓库索引文件：

```
REPOSITORY_INDEX.md
```

该文件包含：
- 完整的文件树和项目结构
- 数据模型说明（7 个 Prisma 模型及其关系）
- 核心架构（四层缓存、数据流、关键技术点）
- 开发命令和环境变量

阅读索引后，确认你理解了以下内容再开始编码：
1. 要修改/新增的代码属于哪个模块
2. 该模块与哪些文件有依赖关系
3. 有哪些现有模式（如 Anthropic SDK 统一调用、SSE 流式 tee 分流、归属校验链路）必须保持一致

## 完成工作后

**每次完成构建或修改后**，必须更新 `REPOSITORY_INDEX.md`（该文件已加入 `.gitignore`，仅本地维护，不要提交到 Git）：

1. **新增文件**：将新文件添加到文件树对应位置，并简要说明其功能
2. **删除文件**：从文件树中移除对应条目
3. **架构变更**：如果新增或修改了核心架构（如新增缓存层、新增 API 路由模式），在相关章节补充说明
4. **新增依赖**：如果安装了新的 npm 包，在关键技术点或开发命令中体现
5. **更新时间戳**：更新文件顶部的「最后更新」日期

更新原则：
- 保持文件树与实际目录结构一致
- 新增的关键模块需要在「关键技术点」章节添加条目
- 不要删除历史内容（除非已废弃），保留项目演进记录
- 如果只是修改了已有文件的内部逻辑（不改变文件结构和模块职责），通常不需要更新索引
- **注意**：`REPOSITORY_INDEX.md` 已 gitignore，禁止 `git add` 该文件

## Git 操作

本项目是个人开发项目，采用**干主线开发**。所有工作直接在 `main` 分支上进行。

### 基本流程

```shell
git pull origin main          # 开始前同步远端
# … 编码、测试、lint、build …
git add .
git commit -m "feat: 简短描述"
git push origin main
```

### 分支策略

- **默认不建分支**，直接在 `main` 上开发和提交。
- **未完成的功能用开关控制**：环境变量、配置项或条件判断隐藏，而不是靠长期分支隔离。
- **分支仅用于高风险短命实验**：验证一个想法，活不过一天，验证完立即合并或删除。分支名用 `/` 前缀区分，不需要人名前缀。

### 开工前

```shell
git status                    # 确认无意外未提交内容
git pull origin main          # 同步远端
```

不要执行 `git reset --hard`、`git checkout -- .`、`git clean -fd` 等破坏性命令，除非明确知道未提交改动是废弃的。

## UI 设计语言

学生端工作台采用现代科技极简风格。后续所有 UI 修改必须遵守以下规则：

1. **按钮和卡片禁止使用可见边框**：按钮、项目卡片、资料卡片、导航卡片、统计卡片等卡片式容器，在默认、hover、active、selected、focus-visible、disabled 状态下都不得使用 `border`、`ring`、`outline` 或 `box-shadow: 0 0 0 1px ...` 形成描边包裹。
2. **禁止深灰 hover / selected**：选中态、指针悬浮态、菜单 focus 态和 active 态不得使用深灰、黑灰、重灰块（如 slate/zinc/neutral/stone 800/900、低亮度 OKLCH 灰、`#2*`/`#3*` 近黑灰）作为反馈色。必须使用半透明极浅灰、轻色填充、低饱和色块、文字/图标权重或扁平 spotlight。
3. **状态表达只能用扁平方式**：可点击、悬浮、选中、危险态通过背景填充、半透明浅灰、低饱和色块、文字/图标权重、扁平 spotlight 或轻微色彩变化表达，不用描边强调。
4. **卡片层级靠留白和内容层级**：卡片之间用间距、背景明度、内容密度和标题权重区分，不使用边框分割，也不使用 hover 上浮。
5. **例外范围要很窄**：输入框、表格、Markdown 代码块、模态容器、分隔线等非按钮/非卡片元素可以按可读性保留细线；如果一个元素视觉上承担按钮或卡片角色，即使底层是 `div`、`Link` 或 shadcn 组件，也按本规则处理。

完成本次任务的全部构建之后，进行：

```shell
git add . 
```

```shell
git commit -m "使用英文在这里填写简短的任务总结，格式为 [类型]: 简要的任务内容"
#e.g. git commit -m "docs: add repository index, agent rules, and README"
#e.g. git commit -m "feat: add four-layer cache architecture design"
```

```shell
git push
```

## README.md 文件编写原则

符合github风格和规范

语言简洁，不使用“不是……而是……”类型的反对再肯定的语言

不使用emoji

README主要内容为：

```plaintext
项目简介
项目结构
架构设计
核心特性
快速开始
使用指南
部署
贡献
```
