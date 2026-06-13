/**
 * Task Router — 基于规则 + 关键词的任务识别。
 * MVP 阶段不使用 LLM，纯规则判断。
 */

// ============================================================
// 类型
// ============================================================

export type ProjectType = "experiment" | "review" | "coding" | "general";

export interface TaskProfile {
  taskTypes: string[];
  domain: string;
  mode: ProjectType;
  suggestedOutput: "Markdown" | "Code" | "Mixed";
  needsFiles: boolean;
  missingInfo: string[];
}

export interface RouteInput {
  userMessage: string;
  projectType?: ProjectType;
  fileNames: string[];
  fileExtensions: string[];
}

// ============================================================
// 关键词词典
// ============================================================

const EXPERIMENT_KEYWORDS = [
  "实验", "数据", "表格", "误差", "报告", "曲线", "相量图",
  "计算过程", "测量", "仪器", "信号", "电路", "频率",
  "示波器", "万用表", "仿真", "波形", "电压", "电流",
  "标准偏差", "标准差", "有效数字", "不确定度",
];

const REVIEW_KEYWORDS = [
  "课件", "试卷", "笔记", "复习", "考点", "知识点", "速记",
  "覆盖度", "错题", "考题", "考试", "期末", "期中",
  "总结", "归纳", "大纲", "重点", "难点", "题型",
  "思维导图", "mindmap", "知识结构",
];

const CODING_KEYWORDS = [
  "代码", "报错", "函数", "调试", "复杂度", "bug",
  "debug", "运行", "编译", "算法", "数据结构",
  "README", "注释", "import", "class", "def ",
];

const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".c", ".cpp",
  ".h", ".java", ".sql", ".html", ".css", ".json",
];

const DOMAIN_MAP: Record<string, string> = {
  "电路": "电路实验",
  "信号": "信号与系统",
  "网络": "计算机网络",
  "操作系统": "操作系统",
  "数据结构": "数据结构",
  "算法": "算法设计与分析",
  "编译": "编译原理",
  "数据库": "数据库系统",
  "组成": "计算机组成原理",
  "体系结构": "计算机体系结构",
  "软件工程": "软件工程",
  "python": "Python 程序设计",
  "c语言": "C 语言程序设计",
  "java": "Java 程序设计",
  "机器学习": "机器学习",
  "深度学习": "深度学习",
  "人工智能": "人工智能",
};

// ============================================================
// 路由逻辑
// ============================================================

export function routeTask(input: RouteInput): TaskProfile {
  const { userMessage, projectType, fileNames, fileExtensions } = input;
  const lowerMessage = userMessage.toLowerCase();

  // Count keyword matches
  const experimentScore = EXPERIMENT_KEYWORDS.filter((k) =>
    lowerMessage.includes(k)
  ).length;
  const reviewScore = REVIEW_KEYWORDS.filter((k) =>
    lowerMessage.includes(k)
  ).length;
  const codingScore = CODING_KEYWORDS.filter((k) =>
    lowerMessage.includes(k)
  ).length;

  const hasCodeFiles = fileExtensions.some((ext) =>
    CODE_EXTENSIONS.includes(ext.toLowerCase())
  );

  // Determine mode from keyword scores and project type
  let mode: ProjectType = projectType || "general";

  if (mode === "general") {
    if (experimentScore > reviewScore && experimentScore > codingScore) {
      mode = "experiment";
    } else if (reviewScore > experimentScore && reviewScore > codingScore) {
      mode = "review";
    } else if (codingScore > experimentScore || hasCodeFiles) {
      mode = "coding";
    }
  }

  // Determine task types
  const taskTypes: string[] = [];
  if (lowerMessage.includes("实验报告") || mode === "experiment" && lowerMessage.includes("报告"))
    taskTypes.push("实验报告生成");
  if (lowerMessage.includes("数据") || lowerMessage.includes("表格") || lowerMessage.includes("计算"))
    taskTypes.push("实验数据计算");
  if (lowerMessage.includes("图") || lowerMessage.includes("绘制") || lowerMessage.includes("plot"))
    taskTypes.push("图表绘制");
  if (lowerMessage.includes("代码解释") || (hasCodeFiles && lowerMessage.includes("解释")))
    taskTypes.push("代码解释");
  if (lowerMessage.includes("报错") || lowerMessage.includes("错误") || lowerMessage.includes("bug") || lowerMessage.includes("debug"))
    taskTypes.push("代码调试");
  if (lowerMessage.includes("思考题"))
    taskTypes.push("思考题整理");
  if (lowerMessage.includes("错题") || lowerMessage.includes("改错"))
    taskTypes.push("错题解析");
  if (lowerMessage.includes("试卷") || lowerMessage.includes("考题"))
    taskTypes.push("试卷分析");
  if (lowerMessage.includes("课件") || lowerMessage.includes("总结") || lowerMessage.includes("笔记"))
    taskTypes.push("课件总结");
  if (lowerMessage.includes("覆盖") || lowerMessage.includes("考点"))
    taskTypes.push("知识点覆盖分析");
  if (lowerMessage.includes("速记") || lowerMessage.includes("考前"))
    taskTypes.push("速记资料生成");
  if (lowerMessage.includes("思维导图") || lowerMessage.includes("mindmap") || lowerMessage.includes("结构图"))
    taskTypes.push("Mermaid 思维导图生成");
  if (lowerMessage.includes("latex") || lowerMessage.includes("公式"))
    taskTypes.push("LaTeX 公式整理");
  if (lowerMessage.includes("markdown") || lowerMessage.includes("格式化"))
    taskTypes.push("Markdown 格式化");

  if (taskTypes.length === 0) {
    taskTypes.push("普通问答");
  }

  // Detect domain
  let domain = "其他";
  for (const [keyword, name] of Object.entries(DOMAIN_MAP)) {
    if (lowerMessage.includes(keyword)) {
      domain = name;
      break;
    }
  }

  // Check if files would be helpful
  const needsFiles = fileNames.length === 0 && (
    mode === "experiment" ||
    mode === "review" ||
    hasCodeFiles
  );

  const missingInfo: string[] = [];
  if (needsFiles) {
    missingInfo.push("建议上传相关文件（实验数据、课件、代码等）以获得更准确的分析");
  }
  if (taskTypes.includes("实验报告生成") && fileNames.length === 0) {
    missingInfo.push("需要实验相关的截图、数据表或记录");
  }
  if (taskTypes.includes("试卷分析") && fileNames.length === 0) {
    missingInfo.push("需要上传试卷文件");
  }

  return {
    taskTypes,
    domain,
    mode,
    suggestedOutput: mode === "coding" ? "Code" : "Markdown",
    needsFiles,
    missingInfo,
  };
}
