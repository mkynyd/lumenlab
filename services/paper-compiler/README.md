# LumenLab Paper Compile Service

这是与 Next.js Web 进程分离的 Paper Compile Worker。它消费现有
`PaperCompilation`（CompileJob）表，不创建第二套队列、Agent Runtime 或事件系统。

Web 进程设置 `PAPER_COMPILE_WORKER_ENABLED=false`，独立进程设置
`PAPER_COMPILE_SERVICE_MODE=true` 后运行：

```bash
npm run paper:compiler
```

可以用仓库根目录的 `docker-compose.paper-compiler.yml` 生成独立服务配置：

```bash
docker compose -f docker-compose.yml -f docker-compose.paper-compiler.yml config
```

该配置使用非 root 用户、只读根文件系统、独立 tmpfs、`cap_drop: ALL`、
`no-new-privileges`、CPU/内存/PID/文件大小限制，并且不发布编译端口。
Worker 本身必须保留控制面网络来访问 PostgreSQL 与现有对象存储；不能把整个
Worker 设置为 `network_mode: none`，否则它无法消费 `PaperCompilation`。真正的
XeLaTeX、BibTeX、Biber 子进程在镜像中通过 `bubblewrap` 启用
`--unshare-net`、只读根挂载和仅编译目录可写的 mount namespace。若对象存储使用
七牛，只有 Worker 控制面需要外网访问；模板工具链不会继承该网络。

编译子进程不会继承应用环境变量，只接收受限的 TeX 环境；每个 Job 使用临时目录、
`shell: false`、`--no-shell-escape`、超时、文件数、输入/产物大小和日志大小限制。
`PAPER_COMPILE_LINUX_SANDBOX=true` 时找不到 `bwrap` 会直接失败，不会静默退回未隔离执行。

当前服务入口与 Web 端共用 `src/lib/paper/compile-worker.ts` 的 Job claim、渲染、对象存储和错误映射 seam，便于后续将执行器进一步拆成独立 RPC 而不改变 `PaperCompilation` 合同。
