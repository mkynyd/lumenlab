import "dotenv/config";
import { startPaperCompilationWorker } from "@/lib/paper/compile-worker";

if (process.env.PAPER_COMPILE_SERVICE_MODE === "false") {
  throw new Error("PAPER_COMPILE_SERVICE_MODE=false，拒绝启动独立 Paper Compile Service");
}

const result = startPaperCompilationWorker();
console.info(JSON.stringify({ service: "paper-compiler", ...result, pid: process.pid }));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
