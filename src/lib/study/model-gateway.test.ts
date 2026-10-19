import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ key: vi.fn(), quota: vi.fn(), usage: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/data/provider-access", () => ({ getProviderApiKey: mocks.key }));
vi.mock("@/lib/tokens/quota", () => ({ checkQuotaForRequest: mocks.quota, recordTokenUsage: mocks.usage }));
vi.mock("@/lib/agent/providers/responses/transport", () => ({ postResponses: mocks.post }));
import { solveSelectedQuestion, studyModelJson } from "./model-gateway";
import { solutionSchema } from "./contracts";
const solution = { answer: "A", explanation: "完整推导", topics: ["极限"] };
const response = (body: unknown) => ({ status: "completed", output_text: JSON.stringify(body), usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BAILIAN_WORKSPACE_ID", "test-workspace");
  vi.stubEnv("MODEL_QWEN_ENABLED", "true");
  mocks.key.mockResolvedValue("test-key");
  mocks.quota.mockResolvedValue({ allowed: true });
});
describe("independent solvers and bounded verification", () => {
  it("replaces disabled Qwen with independent MiniMax solving and records the actual candidates", async () => {
    vi.stubEnv("MODEL_QWEN_ENABLED", "false");
    mocks.post.mockResolvedValueOnce(response(solution)).mockResolvedValueOnce(response(solution)).mockResolvedValueOnce(response({ deepseekCorrect: true, qwenCorrect: true, evidenceComplete: true, reason: "复算通过" }));
    const progress = vi.fn().mockResolvedValue(undefined);
    const result = await solveSelectedQuestion({ userId: "owner", question: "题目", syllabus: "", sources: [], progress });
    expect(mocks.key.mock.calls.map(call => call[1])).toEqual(["deepseek", "minimax", "minimax"]);
    expect(mocks.post.mock.calls.map(call => call[0].body.model)).toEqual(["deepseek-flash", "MiniMax-M3.1-Flash-Preview", "MiniMax-M3.1-Flash-Preview"]);
    expect(result.candidateModels).toEqual({ deepseek: "deepseek-flash", qwen: "minimax-m3.1" });
    expect(progress).toHaveBeenCalledWith("MiniMax M3.1 独立解析");
  });
  it("uses DeepSeek for OCR and extraction when Qwen is disabled, including billed model provenance", async () => {
    vi.stubEnv("MODEL_QWEN_ENABLED", "false");
    mocks.post.mockResolvedValue(response(solution));
    await studyModelJson({ userId: "owner", provider: "bailian", prompt: "题目", schema: solutionSchema });
    expect(mocks.key).toHaveBeenCalledWith("owner", "deepseek");
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ model: "deepseek-flash", provider: "deepseek" }));
  });
  it("passes identical evidence to independent solvers and adopts DeepSeek only after verification", async () => {
    mocks.post.mockResolvedValueOnce(response(solution)).mockResolvedValueOnce(response({ ...solution, explanation: "另一种推导" })).mockResolvedValueOnce(response({ deepseekCorrect: true, qwenCorrect: true, evidenceComplete: true, reason: "复算通过" }));
    const progress = vi.fn().mockResolvedValue(undefined);
    const result = await solveSelectedQuestion({ userId: "owner", question: "计算极限", syllabus: "极限", sources: [], progress });
    expect(result.solution).toEqual(solution);
    expect(mocks.post.mock.calls[0][0].body.input).toEqual(mocks.post.mock.calls[1][0].body.input);
    expect(mocks.post.mock.calls[1][0].body.store).toBe(false);
    expect(mocks.post.mock.calls[0][0].body.tools).toBeUndefined();
    expect(JSON.stringify(mocks.post.mock.calls[0][0].body.instructions)).toContain("JSON Schema");
    expect(JSON.stringify(mocks.post.mock.calls[0][0].body.instructions)).toContain("additionalProperties");
    expect(mocks.usage).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenCalledTimes(3);
  });
  it("retains candidates but abstains when the independent check fails", async () => {
    mocks.post.mockResolvedValueOnce(response(solution)).mockResolvedValueOnce(response(solution)).mockResolvedValueOnce(response({ deepseekCorrect: true, qwenCorrect: false, evidenceComplete: true, reason: "第二份推导遗漏定义域" }));
    const result = await solveSelectedQuestion({ userId: "owner", question: "题目", syllabus: "", sources: [], progress: async () => {} });
    expect(result.solution).toBeNull();
    expect(result.candidates.deepseek).toEqual(solution);
  });
  it("records billed usage even for incomplete output and never accepts truncation", async () => {
    mocks.post.mockResolvedValue({ ...response(solution), status: "incomplete" });
    await expect(studyModelJson({ userId: "owner", provider: "deepseek", prompt: "题目", schema: solutionSchema })).rejects.toThrow("未完成");
    expect(mocks.usage).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it("blocks quota failures before resolving credentials or calling a model", async () => {
    mocks.quota.mockResolvedValue({ allowed: false });
    await expect(studyModelJson({ userId: "owner", provider: "deepseek", prompt: "题目", schema: solutionSchema })).rejects.toThrow("额度");
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("retries malformed JSON once with identical evidence and bills both completed responses", async () => {
    mocks.post.mockResolvedValueOnce({ ...response(solution), output_text: '{"answer":"2","explanation":"计算"1+1"","topics":[]}' }).mockResolvedValueOnce(response(solution));
    expect(await studyModelJson({ userId: "owner", provider: "bailian", prompt: "完整题干和检索资料", schema: solutionSchema })).toEqual(solution);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[0][0].body.input).toEqual(mocks.post.mock.calls[1][0].body.input);
    expect(mocks.post.mock.calls[1][0].body.instructions).toContain("正确转义");
    expect(mocks.usage).toHaveBeenCalledTimes(2);
  });
  it("never coerces invalid fields or accepts a second malformed reply", async () => {
    mocks.post.mockResolvedValue(response({ ...solution, answer: 2 }));
    await expect(studyModelJson({ userId: "owner", provider: "bailian", prompt: "题目", schema: solutionSchema })).rejects.toMatchObject({ reason: "invalid_contract", provider: "bailian" });
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.usage).toHaveBeenCalledTimes(2);
  });
});
