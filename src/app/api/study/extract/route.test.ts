// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), model: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/study/model-gateway", () => ({ studyModelJson: mocks.model }));
vi.mock("@/lib/study/render-document", () => ({ renderStudyDocument: mocks.render }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); });
it.each(["", "blob"])("accepts pasted requirements with an empty file control named %j", async (name) => {
  const form = new FormData(); form.set("mode", "tasks"); form.set("text", "10月3日18点前提交报告。"); form.set("file", new File([], name));
  mocks.model.mockResolvedValue({ tasks: [], questions: ["请确认年份"] });
  const response = await POST(new Request("http://localhost/api/study/extract", { method: "POST", body: form }));
  expect(await response.json()).toEqual({ tasks: [], questions: ["请确认年份"] });
  expect(response.status).toBe(200);
  expect(mocks.model).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner" }));
  expect(mocks.render).not.toHaveBeenCalled();
});
it("rejects a deliberately selected zero-byte document", async () => {
  const form = new FormData(); form.set("mode", "tasks"); form.set("file", new File([], "broken.pdf"));
  expect((await POST(new Request("http://localhost/api/study/extract", { method: "POST", body: form }))).status).toBe(422);
  expect(mocks.model).not.toHaveBeenCalled();
});
