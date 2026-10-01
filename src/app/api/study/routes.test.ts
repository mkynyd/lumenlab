import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), collectionList: vi.fn(), collectionCreate: vi.fn(), notebookCreate: vi.fn(), collectionRead: vi.fn(), transaction: vi.fn(), taskList: vi.fn(), taskCreate: vi.fn(), taskUpdate: vi.fn(), preferencesRead: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: {
  studyCollection: { findMany: mocks.collectionList, create: mocks.collectionCreate, findUniqueOrThrow: mocks.collectionRead },
  mistakeNotebook: { create: mocks.notebookCreate },
  studyPreferences: { findUnique: mocks.preferencesRead },
  studyTask: { findMany: mocks.taskList, create: mocks.taskCreate, updateMany: mocks.taskUpdate },
  $transaction: mocks.transaction,
} }));
import { GET as collections, POST as createCollection } from "./collections/route";
import { GET as tasks, POST as createTask } from "./tasks/route";
import { GET as preferences } from "./preferences/route";
import { PATCH as finishTask } from "./tasks/[id]/route";
const request = (body: unknown) => new Request("http://localhost/api/study", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  mocks.collectionList.mockResolvedValue([]);
  mocks.taskList.mockResolvedValue([]);
  mocks.collectionCreate.mockResolvedValue({ id: "collection" });
  mocks.collectionRead.mockResolvedValue({ id: "collection", notebooks: [{ id: "book" }] });
  mocks.transaction.mockImplementation(async callback => callback({ studyCollection: { create: mocks.collectionCreate, findUniqueOrThrow: mocks.collectionRead }, mistakeNotebook: { create: mocks.notebookCreate } }));
});
describe("study ownership and input boundary", () => {
  it("rejects all unauthenticated actions before touching storage", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const result of [await collections(), await tasks(), await preferences(), await createCollection(request({})), await createTask(request({})), await finishTask(request({ completed: true }), { params: Promise.resolve({ id: "foreign" }) })]) expect(result.status).toBe(401);
    expect(mocks.collectionList).not.toHaveBeenCalled();
    expect(mocks.preferencesRead).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
  });
  it("lists only owner resources", async () => {
    await collections(); await tasks();
    expect(mocks.collectionList.mock.calls[0][0].where).toEqual({ userId: "owner" });
    expect(mocks.taskList.mock.calls[0][0].where).toEqual({ userId: "owner" });
  });
  it("rejects spoofed ownership and invalid tasks before writing", async () => {
    expect((await createCollection(request({ name: "数学", subject: "数学", stage: "university", userId: "victim" }))).status).toBe(400);
    expect((await createTask(request({ title: "作业", deadline: "tomorrow", estimatedMinutes: -5 }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.taskCreate).not.toHaveBeenCalled();
  });
  it("reads only the current user’s saved timing preferences", async () => {
    mocks.preferencesRead.mockResolvedValue({ periods: [] });
    expect((await preferences()).status).toBe(200);
    expect(mocks.preferencesRead.mock.calls[0][0].where).toEqual({ userId: "owner" });
  });
  it("creates collection and default notebook in one transaction", async () => {
    expect((await createCollection(request({ name: "数学二", subject: "数学", stage: "university" }))).status).toBe(201);
    expect(mocks.collectionCreate.mock.calls[0][0].data.userId).toBe("owner");
    expect(mocks.notebookCreate).toHaveBeenCalledWith({ data: { collectionId: "collection", name: "错题本" } });
  });
  it("returns 404 for another user's task without a separate unsafe write", async () => {
    mocks.taskUpdate.mockResolvedValue({ count: 0 });
    expect((await finishTask(request({ completed: true }), { params: Promise.resolve({ id: "foreign" }) })).status).toBe(404);
    expect(mocks.taskUpdate).toHaveBeenCalledWith({ where: { id: "foreign", userId: "owner" }, data: { completed: true } });
  });
});
