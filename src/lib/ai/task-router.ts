/**
 * Task Router — 基于规则 + 关键词的任务识别。
 * 不使用 LLM，纯规则判断，零 token 消耗。
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
// 关键词词典（泛化版）
// ============================================================

const EXPERIMENT_KEYWORDS = [
  "实验", "数据", "表格", "误差", "报告", "曲线", "相量图",
  "计算过程", "测量", "仪器", "信号", "电路", "频率",
  "示波器", "万用表", "仿真", "波形", "电压", "电流",
  "标准偏差", "标准差", "有效数字", "不确定度",
  "解剖", "标本", "试剂", "培养基", "滴定", "色谱",
  "观测", "实地", "采样", "问卷调查", "统计分析",
];

const REVIEW_KEYWORDS = [
  "课件", "试卷", "笔记", "复习", "考点", "知识点", "速记",
  "覆盖度", "错题", "考题", "考试", "期末", "期中",
  "总结", "归纳", "大纲", "重点", "难点", "题型",
  "思维导图", "mindmap", "知识结构",
  "考研", "备考", "背诵", "记忆", "梳理", "提纲",
  "教案", "备课", "课时", "教学设计", "板书",
  "名词解释", "辨析", "论述", "案例分析", "病例",
];

const CODING_KEYWORDS = [
  "代码", "报错", "函数", "调试", "复杂度", "bug",
  "debug", "运行", "编译", "算法", "数据结构",
  "README", "注释", "import", "class", "def ",
  "编程", "脚本", "爬虫", "自动化", "接口", "API",
  "数据库查询", "SQL", "正则", "前端", "后端",
];

const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".c", ".cpp",
  ".h", ".java", ".sql", ".html", ".css", ".json",
  ".go", ".rs", ".rb", ".php", ".swift", ".kt",
];

const DOMAIN_MAP: Record<string, string> = {
  // 计算机科学
  "电路": "电路与电子技术",
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
  // 理工科
  "物理": "物理学",
  "化学": "化学",
  "生物": "生物学",
  "力学": "力学",
  "材料": "材料科学",
  "自动化": "自动化",
  "电气": "电气工程",
  "机械": "机械工程",
  "土木": "土木工程",
  // 医学
  "解剖": "人体解剖学",
  "生理": "生理学",
  "病理": "病理学",
  "药理": "药理学",
  "临床": "临床医学",
  "诊断": "诊断学",
  "内科": "内科学",
  "外科": "外科学",
  // 经管
  "经济": "经济学",
  "管理": "管理学",
  "金融": "金融学",
  "会计": "会计学",
  "营销": "市场营销",
  // 文科
  "法学": "法学",
  "法律": "法学",
  "哲学": "哲学",
  "历史": "历史学",
  "文学": "文学",
  "语言学": "语言学",
  "社会学": "社会学",
  "心理学": "心理学",
  "教育学": "教育学",
  "新闻": "新闻传播学",
  // 中学学科
  "数学": "数学",
  "英语": "英语",
  "语文": "语文",
  "地理": "地理",
  "政治": "思想政治",
  "化学平衡": "化学",
  "有机": "有机化学",
  // 考研公共课
  "毛中特": "考研政治",
  "马原": "考研政治",
  "史纲": "考研政治",
  "思修": "考研政治",
  "形策": "考研政治",
  "阅读": "考研英语",
  "完形": "考研英语",
  "翻译": "翻译",
  "写作": "写作",
  "数一": "考研数学",
  "数二": "考研数学",
  "数三": "考研数学",
  "线代": "线性代数",
  "概率论": "概率论与数理统计",
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

  // 实验/实践类
  if (
    lowerMessage.includes("实验报告") ||
    (mode === "experiment" && lowerMessage.includes("报告"))
  )
    taskTypes.push("实验/实践报告生成");
  if (
    lowerMessage.includes("数据") ||
    lowerMessage.includes("表格") ||
    lowerMessage.includes("计算")
  )
    taskTypes.push("数据处理计算");
  if (
    lowerMessage.includes("图") ||
    lowerMessage.includes("绘制") ||
    lowerMessage.includes("plot")
  )
    taskTypes.push("图表绘制");

  // 复习/学习类
  if (
    lowerMessage.includes("课件") ||
    lowerMessage.includes("总结") ||
    lowerMessage.includes("笔记") ||
    lowerMessage.includes("提炼")
  )
    taskTypes.push("资料总结");
  if (lowerMessage.includes("错题") || lowerMessage.includes("改错"))
    taskTypes.push("错题解析");
  if (
    lowerMessage.includes("试卷") ||
    lowerMessage.includes("考题") ||
    lowerMessage.includes("真题")
  )
    taskTypes.push("试卷/题目分析");
  if (lowerMessage.includes("思考题"))
    taskTypes.push("思考题解答");
  if (
    lowerMessage.includes("覆盖") ||
    lowerMessage.includes("考点") ||
    lowerMessage.includes("知识点")
  )
    taskTypes.push("知识点覆盖分析");
  if (
    lowerMessage.includes("速记") ||
    lowerMessage.includes("考前") ||
    lowerMessage.includes("背诵") ||
    lowerMessage.includes("提纲")
  )
    taskTypes.push("背诵提纲/速记生成");
  if (
    lowerMessage.includes("思维导图") ||
    lowerMessage.includes("mindmap") ||
    lowerMessage.includes("结构图") ||
    lowerMessage.includes("知识树")
  )
    taskTypes.push("Mermaid 思维导图生成");
  if (lowerMessage.includes("逐题") || lowerMessage.includes("解析"))
    taskTypes.push("逐题解析");
  if (
    lowerMessage.includes("名词解释") ||
    lowerMessage.includes("辨析") ||
    lowerMessage.includes("定义")
  )
    taskTypes.push("名词解释");
  if (lowerMessage.includes("教案") || lowerMessage.includes("备课") || lowerMessage.includes("教学设计"))
    taskTypes.push("教学设计");

  // 编程类
  if (
    lowerMessage.includes("代码解释") ||
    (hasCodeFiles && lowerMessage.includes("解释"))
  )
    taskTypes.push("代码解释");
  if (
    lowerMessage.includes("报错") ||
    lowerMessage.includes("错误") ||
    lowerMessage.includes("bug") ||
    lowerMessage.includes("debug")
  )
    taskTypes.push("代码调试");

  // 格式类
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
  const needsFiles =
    fileNames.length === 0 &&
    (mode === "experiment" || mode === "review" || hasCodeFiles);

  const missingInfo: string[] = [];
  if (needsFiles) {
    missingInfo.push("建议上传相关文件（资料、数据、代码等）以获得更准确的分析");
  }
  if (
    taskTypes.includes("实验/实践报告生成") &&
    fileNames.length === 0
  ) {
    missingInfo.push("需要实验或实践相关的截图、数据或记录");
  }
  if (
    taskTypes.includes("试卷/题目分析") &&
    fileNames.length === 0
  ) {
    missingInfo.push("需要上传试卷或题目文件");
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
