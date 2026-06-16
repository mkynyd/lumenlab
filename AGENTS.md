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

## Git操作

在执行任何代码修改任务前，必须先判断任务规模，并根据任务类型选择合适的 Git 分支策略。不要在未确认当前分支和远端状态的情况下直接修改代码。

对于宏观级项目架构级重构、项目级新功能添加、数据库结构调整、核心模块重写、目录结构调整、API 设计变更、权限系统调整、构建流程调整、部署流程调整等影响范围较大的任务，必须先切换到 `main` 分支，并拉取远端最新代码：

```shell
git checkout main
git pull origin main
```

然后根据任务分类新建独立分支。分支的分类需要宏观可复用，避免创建过多任务分支。Codex默认分支名使用 `MKYN/` 作为前缀，并使用简短、清晰的英文描述分类内容。例如：

```shell
git checkout -b MKYN/category
```

常见分支命名示例：

```shell
git checkout -b MKYN/cache-architecture
```

**注意**：创建新分支前，检查目前是否已经有可以概括该任务的分支分类，避免创建过多分支

对于小型修改，例如局部 UI 调整、样式细节调整、少量逻辑修改、更换部分组件、修复简单 bug、修改文案、补充少量配置、调整少量页面布局等任务，默认在 `MKYN/misc` 分支进行修改。

如果本地没有 `MKYN/misc` 分支，则先切换到 `main` 并拉取远端最新代码，然后创建 `misc` 分支（Codex默认会使用 `MKYN/` 作为分支前缀）

如果当前任务属于小型修改，但修改过程中发现影响范围扩大，例如需要改动核心数据结构、接口契约、数据库 schema、认证逻辑、构建配置、路由架构或多个核心模块，则应停止继续在 `MKYN/misc` 分支上扩展修改，改为从最新 `main` 新建独立任务分支。

在开始修改前，必须检查当前 Git 状态，确认是否存在未提交内容：

```shell
git status
```

如果发现已有未提交修改，不要随意覆盖、删除或重置。需要先判断这些修改是否属于当前任务。如果不属于当前任务，应保留现有改动，并避免混入本次提交。除非明确知道这些改动是无用的临时内容，否则不要执行 `git reset --hard`、`git checkout -- .`、`git clean -fd` 等破坏性命令。

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
