export type ResearchDomainProfileKey = "general" | "computer_science" | "medicine" | "law";

export interface ResearchDomainProfile {
  key: ResearchDomainProfileKey;
  name: string;
  sourcePriorities: string[];
  evidenceStandards: string[];
  citationRules: string[];
  outputStructure: string[];
  /**
   * Candidate fetch 的 provider 排序依据（详见 candidate-priority.ts）。
   * 语义仅是「已发现候选的读取优先级」，不是 provider allowlist：
   * web / scholarly / project 是并行 evidence channels，未列出的 provider
   * 排在最后而不是被禁止；Sciverse primary + legacy academic fallback 的
   * 检索行为由 source-provider 决定，与本数组无关。
   */
  preferredProviders: string[];
}

const PROFILES: Record<ResearchDomainProfileKey, ResearchDomainProfile> = {
  general: {
    key: "general",
    name: "通用研究",
    sourcePriorities: ["官方文件、原始研究、项目资料、可追溯数据"],
    evidenceStandards: ["记录直接证据、来源版本、时间和精确定位", "重要结论尽量使用独立来源交叉验证"],
    citationRules: ["事实性断言必须能回到当前 Run 的 Evidence", "区分描述、比较、因果和共识，不夸大范围"],
    outputStructure: ["结论", "证据与来源", "冲突和限制"],
    preferredProviders: ["project", "sciverse", "openalex", "crossref", "arxiv", "web"],
  },
  computer_science: {
    key: "computer_science",
    name: "计算机科学",
    sourcePriorities: ["原始论文、官方标准与文档、可复现实验和项目仓库"],
    evidenceStandards: ["区分预印本、同行评审和工程报告", "记录数据集、代码版本、硬件/环境和评测指标"],
    citationRules: ["不得把单一 benchmark 结果泛化为普遍性能", "比较时同时记录任务、数据集、指标和实验设置"],
    outputStructure: ["问题定义", "方法与实验", "结果比较", "复现性与限制"],
    preferredProviders: ["project", "sciverse", "arxiv", "openalex", "semantic_scholar", "crossref", "web"],
  },
  medicine: {
    key: "medicine",
    name: "医学与健康",
    sourcePriorities: ["指南、系统综述、随机对照试验、PubMed 文献和监管机构文件"],
    evidenceStandards: ["记录人群、干预、对照、结局、样本量和研究设计", "区分统计关联、临床意义和因果证据"],
    citationRules: ["不得将研究结果当作个体医疗建议", "明确证据等级、适用人群、风险和日期；冲突指南必须并列表达"],
    outputStructure: ["临床问题", "证据等级", "获益与风险", "适用边界与安全限制"],
    // PubMed 保持领域权威首位（临床/生物医学文献的规范索引）；Sciverse 紧随其后，
    // 承担主要的跨来源论文检索与 chunk 级全文证据。
    preferredProviders: ["pubmed", "sciverse", "openalex", "crossref", "web", "project"],
  },
  law: {
    key: "law",
    name: "法学与政策",
    sourcePriorities: ["现行法律法规、司法解释、官方判例/裁判文书、监管文件和权威评论"],
    evidenceStandards: ["记录法域、有效日期、条文/段落定位和文书层级", "区分法条原文、判例事实、学理观点和推论"],
    citationRules: ["不得把单一判例概括为普遍规则", "所有结论必须带法域与时间范围，并明确非法律意见"],
    outputStructure: ["法域与问题", "规范依据", "裁判/政策分歧", "适用边界与风险"],
    // 现行法律法规与官方判例只能来自权威 Web/项目资料；Sciverse 论文是 secondary
    // 学理来源，不能压过官方渠道。
    preferredProviders: ["web", "project", "sciverse", "crossref", "openalex"],
  },
};

export function resolveResearchDomainProfile(key: string | null | undefined): ResearchDomainProfile {
  if (key && key in PROFILES) return PROFILES[key as ResearchDomainProfileKey];
  return PROFILES.general;
}

export function listResearchDomainProfiles() {
  return Object.values(PROFILES).map((profile) => ({ key: profile.key, name: profile.name }));
}
