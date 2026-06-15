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

**每次完成构建或修改后**，必须更新 `REPOSITORY_INDEX.md`：

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
