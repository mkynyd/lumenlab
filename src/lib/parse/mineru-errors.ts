// MinerU 错误码中文映射 —— 服务端（lib/parse/mineru.ts、API 路由）与前端
// （pdf-convert-client）共用，避免英文 err_msg 原文透传到界面。
// 错误码来源：docs/MinerU/mineru-precision-api.md 第 6 节「错误码」。

export const MINERU_GENERIC_ERROR_MESSAGE = "解析失败，请检查文件后重试";

export const MINERU_ERROR_MESSAGES: Record<string, string> = {
  // Token / 服务级错误
  A0202: "MinerU Token 无效，请检查或更换 Token",
  A0211: "MinerU Token 已过期，请更换新 Token",
  "-500": "请求参数错误，请稍后重试",
  "-10001": "MinerU 服务异常，请稍后重试",
  "-10002": "请求参数错误，请稍后重试",
  // 文件级 err_code
  "-60001": "上传地址生成失败，请稍后重试",
  "-60002": "文件格式检测失败，请确认文件为受支持的格式",
  "-60003": "文件读取失败，请检查文件完整性后重新上传",
  "-60004": "文件内容为空，请上传有效文件",
  "-60005": "文件大小超过 200MB 限制，请压缩或拆分后重试",
  "-60006": "文件页数超过 200 页限制，请拆分后重试",
  "-60007": "MinerU 模型服务暂时不可用，请稍后重试",
  "-60008": "文件读取超时，请稍后重试",
  "-60009": "队列已满，请稍后重试",
  "-60010": "解析失败，MinerU 服务暂时不可用，请稍后重试",
  "-60011": "文件未找到，请重新上传后重试",
  "-60012": "解析任务不存在，请重新发起转换",
  "-60013": "无权访问该解析任务，请重新发起转换",
  "-60014": "任务正在运行中，请稍后重试",
  "-60015": "文件转换失败，请转为 PDF 后重试",
  "-60016": "解析结果导出失败，请稍后重试",
  "-60017": "解析重试次数已达上限，请稍后重试",
  "-60018": "今日解析额度已用完（1000页/天），请明日再试",
  "-60019": "今日解析配额已用完，请明日再试",
  "-60020": "文件拆分失败，请稍后重试",
  "-60021": "文件页数读取失败，请检查文件后重试",
  "-60022": "文件读取失败，请检查网络后重试",
  // 本地解析流程内部错误码（lib/parse/mineru.ts 抛出）
  timeout: "MinerU 解析超时（超过10分钟），请重试",
  "missing-zip-url": "MinerU 未返回解析结果，请重试",
  "invalid-result-zip": "解析结果文件无效，请重试",
  // /api/tools/pdf-to-markdown 非流式请求校验错误码
  "invalid-file": "请选择有效的 PDF 文件",
  "file-too-large": "文件大小超过 200MB 限制，请压缩或拆分后重试",
  "need-token": "您的账户未开通文档解析服务，请在下方输入 MinerU Token",
};

/**
 * 按错误码取中文错误文案。
 * - 已知 code：返回映射文案；
 * - 未知/空 code：返回通用中文文案，绝不透传英文原文；
 * - 无 code 时的 fallback 仅在消息本身含中文时采用（服务端已本地化的
 *   错误消息），否则同样回退到通用中文文案。
 */
export function getMinerUErrorMessage(
  code: unknown,
  fallback?: unknown
): string {
  const normalized =
    typeof code === "string" || typeof code === "number" ? String(code) : "";
  if (normalized) {
    return MINERU_ERROR_MESSAGES[normalized] || MINERU_GENERIC_ERROR_MESSAGE;
  }
  if (
    typeof fallback === "string" &&
    fallback.trim() &&
    /[一-龥]/.test(fallback)
  ) {
    return fallback;
  }
  return MINERU_GENERIC_ERROR_MESSAGE;
}
