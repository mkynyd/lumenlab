import { act, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const hooks = {
  workspace: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  run: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
};

const navigation = {
  runParam: null as string | null,
  replace: vi.fn(),
  push: vi.fn(),
};

const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.runParam ? `run=${navigation.runParam}` : ""),
}));

vi.mock("@/lib/hooks/use-research", () => ({
  useResearchWorkspace: () => hooks.workspace,
  useResearchRun: () => hooks.run,
  useCreateResearchRun: mutation,
  useUpdateResearchWorkspace: mutation,
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

vi.mock("@/lib/hooks/use-research-launch", () => ({
  uploadResearchAttachments: vi.fn(async () => 0),
}));

// ResearchComposer 有自己的测试；这里用保持 placeholder 合同的轻量替身，
// 避免拉入 ChatInput 的文本测量与 Tooltip 依赖。
vi.mock("./research-composer", () => ({
  ResearchComposer: () => <textarea aria-label="消息内容" placeholder="输入一个研究问题，例如：比较两种方法在近五年公开证据中的适用边界" />,
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
    commanderModel: null,
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

function planDetail() {
  return {
    originalRequest: "2025 年 MoE 路由方法的主要改进",
    objective: "评估 2025 年 MoE 路由方法的主要改进",
    intentType: "trend",
    targetTimeRange: "2025",
    evidenceTimeRange: "允许更早基线与后续验证",
    scopeInclusions: ["MoE expert routing mechanism"],
    scopeExclusions: ["generic LLM request routing"],
    assumptions: ["以公开技术证据为准"],
    evaluationDimensions: ["routing mechanism", "load balancing"],
    expectedOutput: "按机制分类并比较证据强度的报告",
    researchGoal: "评估 MoE 路由",
    scope: "近五年公开证据",
    timeRange: "2021-2026",
    sourceStrategy: ["原始论文"],
    completionCriteria: ["给出对比表"],
    expectedOutputs: ["研究报告"],
    researchIntensity: "deep",
    domainProfile: { name: "计算机科学", sourcePriorities: [], evidenceStandards: [], citationRules: [], outputStructure: [], preferredProviders: [] },
  };
}

beforeEach(() => {
  navigation.runParam = null;
  navigation.replace.mockClear();
  navigation.push.mockClear();
  hooks.workspace = { data: workspace, isPending: false, isError: false, refetch: vi.fn() };
  hooks.run = { data: runDetail(), isPending: false, isError: false, refetch: vi.fn() };
});

describe("ResearchWorkspaceView status and progress", () => {
  it("renders the fine-grained durable stage instead of a vague run status", () => {
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    // 阶段标签同时出现在状态行与研究活动面板。
    expect(screen.getAllByText("沿引用关系扩展来源").length).toBeGreaterThan(0);
    expect(screen.queryByText("evaluating")).not.toBeInTheDocument();
  });

  it("shows other internal stages distinctly", () => {
    hooks.run = { ...hooks.run, data: runDetail({ stage: { key: "claim_extraction", label: "提炼并核验命题" } }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getAllByText("提炼并核验命题").length).toBeGreaterThan(0);
  });

  it("shows the planner model display name in the status row when present", () => {
    hooks.run = { ...hooks.run, data: runDetail({ commanderModel: "qwen3.8-flash" }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText(/规划模型 Qwen3\.8-Flash/i)).toBeInTheDocument();
    expect(screen.queryByText(/指挥模型/)).not.toBeInTheDocument();
  });

  it("maps a raw run status to a Chinese label when no fine-grained stage is present", () => {
    hooks.run = { ...hooks.run, data: runDetail({ status: "queued", stage: undefined }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getAllByText("排队中").length).toBeGreaterThan(0);
    expect(screen.queryByText("queued")).not.toBeInTheDocument();
    // 状态变化写入 polite live region。
    expect(screen.getByText("研究状态：排队中")).toBeInTheDocument();
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
    // 报告出现在来源面板之前。
    const sourcesPanel = screen.getByRole("region", { name: "研究来源" });
    expect(report.compareDocumentPosition(sourcesPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Workspace 仍然存在（Run 历史 + 新研究 composer + 完成后的 Follow-up 入口）。
    expect(screen.getByText("MoE 路由研究")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入一个研究问题/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Follow-up Run" })).toBeInTheDocument();
  });

  it("builds a navigable outline from completed report headings", async () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        status: "completed",
        stage: { key: "completed", label: "已完成" },
        reportSnapshot: {
          generatedAt: "2026-01-01T01:00:00.000Z",
          reportDocument: { title: "研究报告：MoE 路由", body: "## 执行摘要\n\n结论。\n\n## 主要发现\n\n### 路由策略\n\n正文。", evidenceRefs: [] },
          citationMap: {},
        },
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    // 目录收进全屏阅读器，对齐参考 UI 的成果详情态。
    await userEvent.setup().click(screen.getByRole("button", { name: "展开阅读" }));
    const reader = screen.getByRole("dialog", { name: /阅读报告/ });
    // 目录在窄屏折叠区与宽屏浮动卡各渲染一份。
    expect(within(reader).getAllByRole("navigation", { name: "报告目录" }).length).toBeGreaterThan(0);
    expect(within(reader).getAllByRole("button", { name: "执行摘要" }).length).toBeGreaterThan(0);
    expect(within(reader).getAllByRole("button", { name: "路由策略" }).length).toBeGreaterThan(0);
  });

  it("does not present a failed final synthesis as a normal-quality report", () => {
    hooks.run = { ...hooks.run, data: runDetail({
      status: "completed",
      stage: { key: "completed", label: "已完成" },
      reportSnapshot: { generatedAt: "2026-01-01T01:00:00.000Z", reportDocument: { title: "研究结果", body: "## 综合阶段未完成", evidenceRefs: [], qualityState: "degraded" }, citationMap: {} },
    }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("不会把诊断性证据摘要伪装成正常高质量报告");
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

  it("renders an empty sources state for a terminal run without evidence", () => {
    hooks.run = { ...hooks.run, data: runDetail({ status: "cancelled", stage: { key: "cancelled", label: "已取消" } }) };
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

describe("ResearchWorkspaceView stage-driven layout", () => {
  it("shows a planning skeleton while the plan is being generated", () => {
    hooks.run = { ...hooks.run, data: runDetail({ status: "planning", stage: { key: "planning", label: "正在规划" }, activePlanVersion: null }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("正在生成研究计划")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "研究计划" })).not.toBeInTheDocument();
  });

  it("makes the plan review card the primary content while awaiting confirmation", async () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        status: "awaiting_confirmation",
        stage: { key: "awaiting_confirmation", label: "等待确认计划" },
        activePlanVersion: { plan: planDetail() },
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    const card = screen.getByRole("region", { name: "研究计划" });
    expect(within(card).getByText("1 个研究问题")).toBeInTheDocument();
    expect(within(card).getByText("2025")).toBeInTheDocument();
    expect(within(card).getByText("2025 年 MoE 路由方法的主要改进")).toBeInTheDocument();
    expect(card).toHaveTextContent("generic LLM request routing");
    expect(card).toHaveTextContent("按机制分类并比较证据强度的报告");
    expect(within(card).getByRole("button", { name: "开始研究" })).toBeInTheDocument();
    // 调整入口收进「编辑」开关，对齐参考 UI 的确认方案态。
    await userEvent.setup().click(within(card).getByRole("button", { name: "编辑" }));
    expect(within(card).getByRole("button", { name: "提交调整" })).toBeInTheDocument();
    // awaiting_confirmation 不渲染进行中分组（进度摘要 / 当前任务）。
    expect(screen.queryByText("进度摘要")).not.toBeInTheDocument();
    expect(screen.queryByText("当前任务")).not.toBeInTheDocument();
  });

  it("groups in-progress sections for active runs", () => {
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("正在研究")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "研究总体进度" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /研究活动/ })).toBeInTheDocument();
  });

  it("lets users collapse and reopen the research activity panel", async () => {
    const user = userEvent.setup();
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    await user.click(screen.getByRole("button", { name: "收起活动" }));
    expect(screen.queryByRole("complementary", { name: /研究活动/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "研究活动" }));
    expect(screen.getByRole("complementary", { name: /研究活动/ })).toBeInTheDocument();
  });

  it("keeps advanced operations collapsed by default for terminal runs", () => {
    hooks.run = { ...hooks.run, data: runDetail({ status: "completed", stage: { key: "completed", label: "已完成" } }) };
    const { container } = render(<ResearchWorkspaceView workspaceId="ws-1" />);
    const details = container.querySelector("details[data-testid='advanced-operations']");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/Evidence \/ Claims \/ 追加方向/)).toBeInTheDocument();
  });

  it("does not render advanced operations for active runs", () => {
    const { container } = render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(container.querySelector("details[data-testid='advanced-operations']")).toBeNull();
  });
});

describe("ResearchWorkspaceView run selection via URL", () => {
  it("selects the run named by ?run= and marks it current", () => {
    navigation.runParam = "run-2";
    hooks.workspace = {
      ...hooks.workspace,
      data: {
        ...workspace,
        runs: [
          { id: "run-1", question: "比较 MoE 路由方法", status: "researching", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "run-2", question: "补充反方证据", status: "completed", createdAt: "2026-01-02T00:00:00.000Z" },
        ],
      },
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByRole("button", { name: /补充反方证据/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /比较 MoE 路由方法/ })).not.toHaveAttribute("aria-current");
  });
});

describe("ResearchWorkspaceView question progress indicators", () => {
  it("numbers pending and in-progress questions instead of rendering empty circles", () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        questions: [
          { id: "q1", key: "q1", title: "路由方法", question: "有哪些路由方法？", priority: "critical", status: "resolved", completionCriteria: [] },
          { id: "q2", key: "q2", title: "负载均衡", question: "如何负载均衡？", priority: "high", status: "researching", completionCriteria: [] },
          { id: "q3", key: "q3", title: "训练稳定性", question: "稳定性如何？", priority: "normal", status: "pending", completionCriteria: [] },
        ],
      }),
    };
    const { container } = render(<ResearchWorkspaceView workspaceId="ws-1" />);
    // 已完成的问题保留完成态图标，未完成的问题显示序号。
    expect(screen.getByTitle("路由方法 · 已完成")).toBeInTheDocument();
    expect(screen.getByTitle("负载均衡 · 正在处理")).toHaveTextContent("2");
    expect(screen.getByTitle("训练稳定性 · 等待开始")).toHaveTextContent("3");
    // 空圆圈（伪 affordance）不再渲染。
    expect(container.querySelector(".border-dashed")).toBeNull();
    const progress = screen.getByRole("progressbar", { name: "研究总体进度" });
    expect(progress).toHaveAttribute("aria-valuenow", "45");
  });
});

describe("ResearchWorkspaceView live event linkage", () => {
  class MockEventSource {
    static instances: MockEventSource[] = [];
    listeners = new Map<string, (event: MessageEvent) => void>();
    constructor(public url: string) {
      MockEventSource.instances.push(this);
    }
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      this.listeners.set(type, listener);
    }
    close() {}
    emit(payload: unknown) {
      this.listeners.get("research")?.({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  it("syncs the main card question progress when a public event arrives", () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        agentExecutionId: "exec-1",
        questions: [
          { id: "q1", key: "q1", title: "路由方法", question: "有哪些路由方法？", priority: "critical", status: "researching", completionCriteria: [] },
          { id: "q2", key: "q2", title: "负载均衡", question: "如何负载均衡？", priority: "high", status: "pending", completionCriteria: [] },
        ],
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    const source = MockEventSource.instances[0];
    expect(source).toBeDefined();
    expect(source.url).toContain("/api/research/runs/run-1/events");
    // 事件到达前：q1 进行中、总体进度 35/2 ≈ 18。
    expect(screen.getByRole("progressbar", { name: "研究总体进度" })).toHaveAttribute("aria-valuenow", "18");
    act(() => {
      source.emit({ kind: "question_evaluated", message: "路由方法：已解决", publicData: { questionId: "q1", status: "resolved" } });
    });
    // 主卡圆圈与总进度立即联动，不再等 4s 轮询。
    expect(screen.getByTitle("路由方法 · 已完成")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "研究总体进度" })).toHaveAttribute("aria-valuenow", "50");
  });

  it("prefers live budget counters from events over polled metrics", () => {
    hooks.run = {
      ...hooks.run,
      data: runDetail({ agentExecutionId: "exec-1", metrics: { searchCalls: 1, fetchCalls: 0, modelCalls: 1 } }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    expect(screen.getByText("1 次搜索")).toBeInTheDocument();
    const source = MockEventSource.instances[0];
    act(() => {
      source.emit({ kind: "research_progress", message: "检索中", publicData: { counters: { searchCalls: 7, fetchCalls: 3, modelCalls: 2 } } });
    });
    expect(screen.getByText("7 次搜索")).toBeInTheDocument();
    expect(screen.getByText("7 / 3 / 2")).toBeInTheDocument();
  });
});

describe("ResearchWorkspaceView activity panel a11y", () => {
  it("moves focus into the panel on open and returns it to the toggle on Escape", async () => {
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    const panel = screen.getByRole("complementary", { name: /研究活动/ });
    // 打开时焦点移入面板关闭按钮。
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toHaveAccessibleName("关闭研究活动");
    // Escape 关闭面板，焦点还回主卡的活动开关。
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: /研究活动/ })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toHaveAccessibleName("研究活动");
    });
  });

  it("does not repeat the objective as the panel title", () => {
    hooks.run = { ...hooks.run, data: runDetail({ activePlanVersion: { plan: planDetail() } }) };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    const panel = screen.getByRole("complementary", { name: /研究活动/ });
    expect(within(panel).getByRole("heading", { name: "研究活动" })).toBeInTheDocument();
    // 研究目标只在主卡展示一次，面板标题与副文本不再重复。
    expect(within(panel).queryByText("评估 2025 年 MoE 路由方法的主要改进")).not.toBeInTheDocument();
  });
});

describe("ResearchReportReader focus trap", () => {
  it("traps Tab focus inside the dialog and restores it on close", async () => {
    const user = userEvent.setup();
    hooks.run = {
      ...hooks.run,
      data: runDetail({
        status: "completed",
        stage: { key: "completed", label: "已完成" },
        reportSnapshot: {
          generatedAt: "2026-01-01T01:00:00.000Z",
          reportDocument: { title: "研究报告：MoE 路由", body: "## 执行摘要\n\n结论。", evidenceRefs: [] },
          citationMap: {},
        },
      }),
    };
    render(<ResearchWorkspaceView workspaceId="ws-1" />);
    await user.click(screen.getByRole("button", { name: "展开阅读" }));
    const reader = screen.getByRole("dialog", { name: /阅读报告/ });
    // 打开时焦点在对话框内的关闭按钮。
    expect(reader).toContainElement(document.activeElement as HTMLElement);
    // Tab 循环只在对话框内移动（焦点数量不足以触发回绕时保持在对话框内）。
    for (let index = 0; index < 6; index += 1) await user.tab();
    expect(reader).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /阅读报告/ })).not.toBeInTheDocument();
    });
    // 关闭后焦点还原到触发按钮。
    expect(document.activeElement).toHaveAccessibleName("展开阅读");
  });
});
