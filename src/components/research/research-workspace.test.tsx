import { render as rtlRender, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = {
  workspace: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  run: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
};

const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock("@/lib/hooks/use-research", () => ({
  useResearchWorkspace: () => hooks.workspace,
  useResearchRun: () => hooks.run,
  useCreateResearchRun: mutation,
  useCancelResearchRun: mutation,
  useCreateResearchFollowUp: mutation,
  useConfirmResearchPlan: mutation,
  useReviseResearchPlan: mutation,
  useAppendResearchDirective: mutation,
  useConfirmResearchScope: mutation,
  useCreateResearchEvidence: mutation,
  useUpdateResearchEvidence: mutation,
  useTransferResearchMaterials: mutation,
  useUpdateResearchClaim: mutation,
  useReassessResearchClaim: mutation,
  useUpsertClaimEvidenceRelation: mutation,
}));

const { ResearchWorkspaceView } = await import("./research-workspace");

// ResearchPaperTransferPanel 使用真实 react-query，因此测试需要一个 Provider。
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const workspace = {
  id: "ws-1",
  name: "MoE 路由研究",
  project: null,
  runs: [{ id: "run-1", question: "比较 MoE 路由方法", status: "researching", createdAt: "2026-01-01T00:00:00.000Z" }],
};

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    question: "比较 MoE 路由方法",
    status: "researching",
    stage: { key: "citation_expansion", label: "沿引用关系扩展来源" },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    agentExecutionId: null,
    questions: [{ id: "q1", key: "q1", title: "路由方法", question: "有哪些路由方法？", priority: "critical", status: "partially_resolved", completionCriteria: [] }],
    tasks: [],
    directives: [],
    evidence: [],
    claims: [],
    sourceRelations: [],
    _count: { sourceSnapshots: 0, evidence: 0, claims: 0 },
    metrics: null,
    reportSnapshot: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  hooks.workspace = { data: workspace, isPending: false, isError: false, refetch: vi.fn() };
  hooks.run = { data: runDetail(), isPending: false, isError: false, refetch: vi.fn() };
});

describe("ResearchWorkspaceView status and progress", () => {
  it("renders the fine-grained durable stage instead of a vague run status", () => {
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("沿引用关系扩展来源")).toBeInTheDocument();
    expect(screen.queryByText("evaluating")).not.toBeInTheDocument();
  });

  it("shows other internal stages distinctly", () => {
    hooks.run = { ...hooks.run, data: runDetail({ stage: { key: "claim_extraction", label: "提炼并核验命题" } }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("提炼并核验命题")).toBeInTheDocument();
  });

  it("keeps the workspace usable after a run completes and puts the report first", () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        status: "completed",
        stage: { key: "completed", label: "已完成" },
        reportSnapshot: {
          generatedAt: "2026-01-01T01:00:00.000Z",
          reportDocument: { title: "研究报告：MoE 路由", body: "结论 [E1]。", evidenceRefs: ["ev-1"] },
          citationMap: {},
          coverageSummary: { graph: { edgesDiscovered: 4, sourcesFetched: 2 }, visual: { observationsPersisted: 1 } },
        },
        _count: { sourceSnapshots: 3, evidence: 5, claims: 2 },
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    const report = screen.getByRole("region", { name: "研究报告" });
    expect(within(report).getByText("研究报告：MoE 路由")).toBeInTheDocument();
    // 报告出现在调试面板之前。
    const sourcesPanel = screen.getByRole("region", { name: "研究来源" });
    expect(report.compareDocumentPosition(sourcesPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Workspace 仍然存在（Run 历史 + 新建表单 + 完成后的 Follow-up 入口）。
    expect(screen.getByText("MoE 路由研究")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入研究问题/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Follow-up Run" })).toBeInTheDocument();
  });

  it("reports bounded progress counters including citation expansion and visual evidence", () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        metrics: { searchCalls: 9, fetchCalls: 4, modelCalls: 5 },
        reportSnapshot: {
          generatedAt: "2026-01-01T01:00:00.000Z",
          reportDocument: { body: "x", evidenceRefs: [] },
          citationMap: {},
          coverageSummary: { graph: { edgesDiscovered: 6, sourcesFetched: 3 }, visual: { observationsPersisted: 2 } },
        },
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("6 条边 · 3 个来源")).toBeInTheDocument();
    expect(screen.getByText("2 条观察")).toBeInTheDocument();
    expect(screen.getByText("9 / 4 / 5")).toBeInTheDocument();
    expect(screen.getByText("仅公开状态与计数，不含隐藏推理")).toBeInTheDocument();
  });

  it("explains provider degradation in user language", () => {
    hooks.run = { ...hooks.run, data: runDetail({ degradations: [{ code: "arxiv_error", message: "arXiv 暂时不可用，已使用其它学术来源继续" }] }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("arXiv 暂时不可用，已使用其它学术来源继续")).toBeInTheDocument();
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument();
  });

  it("shows a failure reason instead of a bare failed badge", () => {
    hooks.run = { ...hooks.run, data: runDetail({ status: "failed", stage: { key: "failed", label: "执行失败" }, failureReason: "研究执行超时" }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("研究执行超时");
  });

  it("explains a cancelled run and still offers follow-up", () => {
    hooks.run = { ...hooks.run, data: runDetail({ status: "cancelled", stage: { key: "cancelled", label: "已取消" } }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText(/这次研究已被取消/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Follow-up Run" })).toBeInTheDocument();
  });

  it("renders an empty state when the run has no evidence yet", () => {
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("当前 Run 还没有已读取的来源。")).toBeInTheDocument();
  });
});

describe("ResearchWorkspaceView loading and error states", () => {
  it("shows a workspace loading state", () => {
    hooks.workspace = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("正在加载研究工作区…")).toBeInTheDocument();
  });

  it("shows a recoverable error instead of an endless loading label", () => {
    hooks.workspace = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("研究工作区加载失败");
    expect(screen.queryByText("正在加载研究工作区…")).not.toBeInTheDocument();
  });

  it("shows a run-level error with retry", () => {
    hooks.run = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("这次 Research Run 加载失败，请稍后重试。")).toBeInTheDocument();
  });
});

describe("ResearchWorkspaceView plan confirmation", () => {
  it("shows the plan and the confirmation action only while awaiting confirmation", () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        status: "awaiting_confirmation",
        stage: { key: "awaiting_confirmation", label: "等待确认计划" },
        activePlanVersion: {
          plan: {
            researchGoal: "评估 MoE 路由",
            scope: "近五年公开证据",
            timeRange: "2021-2026",
            sourceStrategy: ["原始论文"],
            completionCriteria: ["给出对比表"],
            expectedOutputs: ["研究报告"],
            researchIntensity: "deep",
            domainProfile: { name: "计算机科学", sourcePriorities: [], evidenceStandards: [], citationRules: [], outputStructure: [], preferredProviders: [] },
          },
        },
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("研究计划")).toBeInTheDocument();
    expect(screen.getByText("2021-2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /确认计划并开始研究/ })).toBeInTheDocument();
  });
});
