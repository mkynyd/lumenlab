import { NextResponse } from "next/server";
import { ResearchServiceError } from "./service";
import { PaperServiceError } from "@/lib/paper/service";

export function researchErrorResponse(error: unknown) {
  if (error instanceof ResearchServiceError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof PaperServiceError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_STATE" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error("research api error", error);
  return NextResponse.json({ error: "研究服务暂时不可用" }, { status: 500 });
}
