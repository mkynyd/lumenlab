import { describe, expect, it } from "vitest";
import { buildResearchPlan } from "./plan";
import { deterministicSourceAssessment } from "./source-triage";
import { deterministicEvaluatorDecision } from "./evaluator";
import { deterministicReportAudit, normalizeReportArchitecture } from "./report-quality";
import { buildResearchBibliography } from "./report-citations";
import { buildReportWriterPrompt, type ReportClaimPacket } from "./prompts";
import type { ResearchCandidate } from "./source-provider";
import type { ResearchQueryStrategyItem } from "./model-stage";

const request = "2025 年 MoE 路由方法的主要改进";
const strategy: ResearchQueryStrategyItem = { query: "2025 mixture of experts routing load balancing", purpose: "primary_work", sourceRole: "primary", freshness: "target_period", questionKey: "q2" };

function candidate(title: string, venue = "EMNLP"): ResearchCandidate {
  return { provider: "sciverse", kind: "academic_paper", externalId: title, title, url: null, metadata: { venue, year: 2025 } };
}

function claim(id: string, marker: string, statement: string): ReportClaimPacket {
  return { id, statement, status: "verified", qualifiers: [], evidence: [{ marker, relation: "supports", statement, excerpt: statement, source: { title: `Source ${marker}`, canonicalKey: `source:${marker}` } }] };
}

describe("Deep Research quality v2 · MoE regression", () => {
  it("preserves intent and decomposes a trend question semantically", () => {
    const plan = buildResearchPlan({ question: request, profile: "deep" });
    expect(plan.originalRequest).toBe(request);
    expect(plan.intentType).toBe("trend");
    expect(plan.evaluationDimensions).toEqual(expect.arrayContaining(["相对基线的变化", "机制类别", "证据强度", "独立验证"]));
    expect(plan.researchQuestions.map((item) => item.question).join(" ")).toMatch(/基线/);
    expect(plan.researchQuestions.map((item) => item.question).join(" ")).toMatch(/类别|方向/);
    expect(plan.researchQuestions.map((item) => item.question).join(" ")).toMatch(/局限/);
  });

  it("rejects domain garbage and keeps serving/recommendation work outside core evidence", () => {
    const classifications = [
      "European Association of Urology Guidelines on Male Sexual and Reproductive Health 2025",
      "Goals in Nutrition Science 2020–2025",
      "Hierarchical Time-Aware Mixture of Experts for Multi-Modal Sequential Recommendation",
      "MegaScale-Infer: Efficient Mixture-of-Experts Model Serving",
      "Stable Expert Routing and Load Balancing for Mixture-of-Experts Models",
    ].map((title) => deterministicSourceAssessment({ question: request, strategy, candidate: candidate(title) }).relevance);
    expect(classifications).toEqual(["irrelevant", "irrelevant", "adjacent", "adjacent", "direct"]);
  });

  it("cannot resolve 'major improvements' from two irrelevant records", () => {
    expect(deterministicEvaluatorDecision({ intentType: "trend", evidence: [
      { sourceRelevance: "irrelevant", sourceRole: "context", scope: "full_text_chunk", canonicalSourceIdentity: "health" },
      { sourceRelevance: "irrelevant", sourceRole: "context", scope: "full_text_chunk", canonicalSourceIdentity: "nutrition" },
    ] }).status).toBe("unresolved");
  });

  it("organizes the report by technical themes and instructs cross-source synthesis", () => {
    const claims = [
      claim("c1", "E1", "路由稳定性改进减少了专家选择抖动。"),
      claim("c2", "E2", "负载均衡方法降低了专家容量溢出。"),
      claim("c3", "E3", "通信感知路由在吞吐与专家利用率之间权衡。"),
    ];
    const architecture = normalizeReportArchitecture({
      thesis: "主要改进集中在稳定选择、负载均衡和系统代价协同。",
      sections: [
        { title: "路由稳定性与专家选择", question: "相对旧基线改了什么", claimIds: ["c1"], comparisonDimensions: ["稳定性"], importance: "high" },
        { title: "负载与通信权衡", question: "怎样兼顾均衡和开销", claimIds: ["c2", "c3"], comparisonDimensions: ["负载", "通信", "吞吐"], importance: "high" },
      ],
      uncertainties: [], excludedClaimIds: [],
    }, new Set(claims.map((item) => item.id)));
    expect(architecture?.sections.map((item) => item.title)).toEqual(["路由稳定性与专家选择", "负载与通信权衡"]);
    const writerPrompt = buildReportWriterPrompt({ plan: buildResearchPlan({ question: request, profile: "deep" }), architecture, claims, profile: "deep" });
    expect(writerPrompt).toContain("not to summarize the retrieved papers one by one");
    expect(writerPrompt).toContain("跨来源");

    const badBulletReport = `## 研究结论\n\n本次研究围绕问题形成以下可核验结论：\n\n- 论文甲提出稳定路由 [E1]\n- 论文乙提出负载均衡 [E2]\n- 论文丙提出通信优化 [E3]\n- 论文丁提出门控方法 [E1]\n- 论文戊提出专家选择 [E2]\n\n## 限制\n\n以上内容只代表当前 Run 已成功读取的来源与核验状态。`;
    expect(deterministicReportAudit({ report: badBulletReport, evidenceRefs: ["ev1", "ev2", "ev3"], claims }).pass).toBe(false);
  });

  it("builds the bibliography from actual citations only and preserves first-use order", () => {
    const evidence = ["1", "2", "3"].map((id) => ({
      id: `ev${id}`,
      evidenceType: "direct_quote",
      sourceSnapshot: { sourceId: `src${id}`, metadata: { provider: "sciverse", scope: { type: "full_text_chunk" } }, source: { id: `src${id}`, kind: "academic_paper", title: `Paper ${id}`, canonicalKey: `doi:${id}`, canonicalUrl: null, doi: id, metadata: { year: 2025 } } },
    })) as never;
    const bibliography = buildResearchBibliography({ evidence, citedEvidenceIds: ["ev3", "ev1"] });
    expect(bibliography.map((item) => item.sourceId)).toEqual(["src3", "src1"]);
    expect(bibliography.flatMap((item) => item.evidenceIds)).not.toContain("ev2");
  });
});
