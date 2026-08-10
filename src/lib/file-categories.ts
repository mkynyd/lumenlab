export const FILE_CATEGORIES = [
  "试卷",
  "作业",
  "课件",
  "讲义",
  "实验",
  "代码",
  "政策通知",
  "通用",
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
