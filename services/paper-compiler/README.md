# LumenLab Paper Compile Service

这是与 Next.js Web 进程分离的 Paper Compile Worker。它消费现有
`PaperCompilation`（CompileJob）表，不创建第二套队列、Agent Runtime 或事件系统。

Web 进程设置 `PAPER_COMPILE_WORKER_ENABLED=false`，独立进程设置
`PAPER_COMPILE_SERVICE_MODE=true` 后运行：

```bash
npm run paper:compiler
```

生产容器应使用非 root 用户、只读根文件系统、独立的 `/tmp` tmpfs、`--network none`、CPU/内存/进程数限制，并只挂载编译所需的数据库和对象存储凭据。编译子进程不会继承应用环境变量，只接收受限的 TeX 环境；每个 Job 使用临时目录、`shell: false`、`--no-shell-escape`、超时、文件数、输入/产物大小和日志大小限制。

当前服务入口与 Web 端共用 `src/lib/paper/compile-worker.ts` 的 Job claim、渲染、对象存储和错误映射 seam，便于后续将执行器进一步拆成独立 RPC 而不改变 `PaperCompilation` 合同。
