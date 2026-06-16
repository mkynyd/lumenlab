export type ProjectType = "experiment" | "review" | "coding" | "general";

export interface QuickActionDefinition {
  title: string;
  prompt: string;
  isSystem?: boolean;
  sortOrder?: number;
}

export const DEFAULT_QUICK_ACTIONS: Record<ProjectType, QuickActionDefinition[]> = {
  experiment: [
    { title: "生成实验报告", prompt: "请基于我选中的资料生成一份可直接复制的实验报告，包含实验目的、实验环境、实验原理、实验步骤、数据处理、结果分析、误差分析和实验结论。如果资料中缺少数据，请明确标注缺失项，不要编造。" },
    { title: "补全表格", prompt: "请基于我选中的资料补全实验表格，逐项列出原始数据、使用公式、代入过程和结果。无法从资料确定的单元格请标注“需补充”，不要编造。" },
    { title: "生成计算过程", prompt: "请基于我选中的资料生成完整计算过程，包含公式说明、数值代入、中间步骤、单位和最终结果。公式使用 LaTeX；缺失数据请明确说明，不要编造。" },
    { title: "生成误差分析", prompt: "请基于我选中的资料生成误差分析，按资料情况计算绝对误差、相对误差、标准偏差或不确定度，并分析主要误差来源和改进方法。资料不足时请标注缺失项，不要编造。" },
    { title: "生成 Python 绘图代码", prompt: "请基于我选中的资料生成可直接运行的 Python matplotlib 绘图代码，包含必要的 import、数据定义、坐标轴名称、单位、图例、网格和 show()。无法确定的数据请保留清晰占位并说明，不要编造。" },
    { title: "整理思考题", prompt: "请基于我选中的资料整理实验思考题，并给出结构清晰的中文参考答案和必要推导。资料未覆盖的问题请明确标注，不要编造实验结论。" },
  ],
  review: [
    { title: "提取知识点", prompt: "请基于我选中的资料提取核心知识点，按章节和依赖关系组织，标注重点、难点和易混点。只总结资料中有依据的内容，缺失部分请说明。" },
    { title: "生成考点索引", prompt: "请基于我选中的资料生成考点索引，列出章节、考点、常见题型、关键公式或方法，并标注资料依据。不要臆测未提供的考试范围。" },
    { title: "分析试卷覆盖度", prompt: "请基于我选中的试卷和复习资料分析知识点覆盖度，统计题型、章节、分值和难度分布。无法确认的分值或对应关系请明确标注，不要编造。" },
    { title: "生成速记版", prompt: "请基于我选中的资料生成可直接复制的考前速记版，使用紧凑的 Markdown 表格和列表，突出定义、公式、步骤、易错点和高频考点。" },
    { title: "整理错题解析", prompt: "请基于我选中的资料整理错题解析，包含错误原因、涉及知识点、正确解法、关键步骤和同类题识别方法。信息不足时请明确说明。" },
    { title: "生成 Mermaid 逻辑图", prompt: "请基于我选中的资料生成 Mermaid flowchart LR（从左到右横向排列），按逻辑依赖排列层级，同级并列，子级递进。严格遵守：1）节点标签只使用纯中文或英文文字，绝对禁止在标签内使用半角括号 ()、大括号 {}、尖括号 <>、脱字符 ^、竖线 |，这些符号会直接导致渲染崩溃；2）所有标签用方括号 [标签] 或圆角方括号 (标签) 包裹；3）每个节点语句独占一行。同时给出可直接复制的 Mermaid 代码块。" },
  ],
  coding: [
    { title: "解释代码", prompt: "请基于我选中的代码资料解释整体结构和关键逻辑，说明主要函数、数据结构、算法流程和输入输出。引用具体文件名，不要假设不存在的实现。" },
    { title: "查找错误", prompt: "请基于我选中的代码和报错信息定位问题，说明原因、影响、最小修复方案和验证步骤。缺少运行信息时请列出需要补充的内容，不要伪造运行结果。" },
    { title: "补全注释", prompt: "请基于我选中的代码补全清晰的中文注释，覆盖模块用途、函数参数、返回值、关键分支和复杂逻辑，并保持原有代码行为不变。" },
    { title: "生成 README", prompt: "请基于我选中的项目资料生成规范的 README.md，包含项目简介、环境要求、安装与运行、目录结构、核心功能和注意事项。无法确认的命令请标注待验证。" },
    { title: "分析复杂度", prompt: "请基于我选中的代码分析主要算法的时间复杂度和空间复杂度，说明推导依据、瓶颈和可行优化，不要脱离实际代码泛泛而谈。" },
    { title: "整理实验报告代码说明", prompt: "请基于我选中的代码生成可用于实验报告的代码说明，包含设计思路、模块结构、关键算法、核心代码解释、运行方式和结果分析。未提供的运行结果请明确标注，不要编造。" },
  ],
  general: [
    { title: "总结要点", prompt: "请总结以下内容的核心要点。" },
    { title: "深入分析", prompt: "请对以下内容进行深入分析和讨论。" },
    { title: "格式化", prompt: "请将以下内容整理为结构清晰的 Markdown 格式。" },
  ],
};

export function getDefaultQuickActions(projectType: string): QuickActionDefinition[] {
  const type = projectType in DEFAULT_QUICK_ACTIONS
    ? (projectType as ProjectType)
    : "general";
  return DEFAULT_QUICK_ACTIONS[type].map((action, index) => ({
    ...action,
    isSystem: true,
    sortOrder: index,
  }));
}
