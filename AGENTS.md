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

## 生产部署流程

生产环境只允许通过仓库内的 `scripts/deploy.sh` 发布。不要在服务器上手工执行 `git pull`、`npm install`、`npm run build`、复制 `.next` 或直接改写 `current` 软链接；这些操作会绕过 CI 门禁、数据库快照、预检和自动回滚。

### 发布前提

- 只有用户明确要求部署时才执行生产发布；普通的提交或推送不自动扩大为部署授权。
- 待发布代码必须已经进入 `main` 并推送到 `origin/main`。
- 先记录待发布的完整 commit SHA，建议始终显式传给部署脚本，避免等待 CI 期间 `main` 又前进。
- GitHub Actions `.github/workflows/ci.yml` 必须全部通过。CI 包含 Linux 上的依赖安装、Prisma generate、lockfile 不可变检查、lint、`tsc --noEmit`、全量测试、数据库迁移演练、生产构建和 whitespace check，以及 macOS lockfile 一致性检查。
- 本机需要可用的 GitHub 凭据（`gh auth token` 或 Git credential）和服务器 SSH 入口；默认 SSH host 为 `remoteDev`，需要覆盖时使用 `DEPLOY_SSH_HOST`。
- 主工作树如有无关未提交或未跟踪文件，必须保留，不得为了部署顺手清理。

### 标准发布

```bash
git status
git pull --ff-only origin main
git push origin main

# 等目标 commit 的 GitHub Actions 全部变绿后
./scripts/deploy.sh deploy <完整-commit-sha>

# 发布后确认 current、systemd、健康状态、磁盘和最近发布记录
./scripts/deploy.sh status
curl -fsS https://lab.mkynstudio.top/api/health
```

部署脚本会自动完成以下步骤：

1. 解析并锁定目标 commit，检查该 commit 的 GitHub Actions check runs。
2. 检查服务器 `/www` 至少有 5GB 可用空间，在独立 `build/` 树中 fetch 并 checkout 精确 commit。
3. 执行 `npm ci --include=dev` 和 `npx prisma generate`。
4. 在迁移前使用 `pg_dump -Fc` 生成数据库快照，保留最近 3 份，然后执行 `npx prisma migrate deploy`。
5. 在低内存生产机上用 `NEXT_BUILD_CPUS=1 NEXT_DEPLOY_SKIP_TYPECHECK=1 NEXT_DEPLOYMENT_ID=<sha> npm run build` 构建。这里只跳过服务器上的重复 typecheck；完整 `tsc --noEmit` 仍必须由 CI 通过，本地和 CI 不得设置 `NEXT_DEPLOY_SKIP_TYPECHECK=1`。
6. 将 standalone、静态资源和 `public/` 组装到 `releases/<commit>/`，并链接共享的 `.env`、`uploads/`、`.lumenlab/` 数据。
7. 通过临时 systemd unit 在 `127.0.0.1:3002` 启动新 release，要求 `/api/health` 返回 `status: healthy`。
8. 预检通过后原子切换 `/www/wwwroot/course-ai-lab/current`，重启 `lumenlab.service`，依次检查本机 `127.0.0.1:3000` 和公网 HTTPS 健康状态。
9. 切换后检查失败时自动把 `current` 恢复到上一 release；成功后仅保留当前版本和最近一个可回滚版本，清理临时构建产物并写入 `deploy.log`。

CI 为 `pending` 或 `failure` 时脚本会拒绝部署。`--skip-ci-check` 只用于没有 CI 记录的历史 commit 或本机确实无法取得 GitHub 凭据的特殊情况，必须先获得用户明确确认；它不能绕过仍在运行或已经失败的 CI。

### 状态、回滚与首次迁移

```bash
# 查看 current、release 列表、systemd 状态、本机健康检查和最近日志
./scripts/deploy.sh status

# 回滚到当前版本之外最新的一个 release，并重新完成本机与 HTTPS 健康检查
./scripts/deploy.sh rollback

# 仅首次把旧部署迁移到 releases/current + systemd 模式时使用
./scripts/deploy.sh bootstrap
```

`bootstrap` 会安装并启用 `deploy/lumenlab.service`，把 Nginx 的站点根目录和 `/_next/static` alias 切到 `current`，停止受控范围内的旧手工进程，再执行完整部署流程。正常发布不得重复使用 `bootstrap`。

生产布局固定为：

```text
/www/wwwroot/course-ai-lab/
├── .env                  # 共享环境变量，不随 release 删除
├── uploads/              # 共享上传数据
├── .lumenlab/            # 共享应用数据
├── releases/<commit>/    # 可运行的 standalone release
├── current -> releases/<commit>
└── build/                # 临时构建树
```

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



## 测试账号

@ LOCALTEST.md
