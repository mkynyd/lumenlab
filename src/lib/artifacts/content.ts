const TOOL_CALL_PATTERNS = [
  /<tool_calls\b[\s\S]*?<\/tool_calls>/gi,
  /<invoke\b[^>]*name=["']activate_skill["'][\s\S]*?<\/invoke>/gi,
  /```(?:json)?\s*[\s\S]*?"tool_calls"\s*:\s*\[[\s\S]*?```/gi,
];

const ACTIVATION_PREAMBLE_PATTERNS = [
  /启动.*(助手|skill|Skill)/i,
  /调用.*(助手|skill|Skill)/i,
  /activate_skill/i,
];

export function containsToolCallMarkup(content: string) {
  return TOOL_CALL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(content);
  });
}

export function stripToolCallMarkup(content: string) {
  return TOOL_CALL_PATTERNS.reduce((next, pattern) => {
    pattern.lastIndex = 0;
    return next.replace(pattern, "");
  }, content)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isArtifactContentSavable(content: string) {
  const cleaned = stripToolCallMarkup(content);
  if (cleaned.length < 24) return false;

  if (containsToolCallMarkup(content)) {
    const looksLikeActivationOnly = ACTIVATION_PREAMBLE_PATTERNS.some((pattern) =>
      pattern.test(cleaned)
    );
    return !looksLikeActivationOnly && cleaned.length >= 120;
  }

  return true;
}

export function suggestArtifactTitle(content: string, fallback = "AI 成果") {
  const cleaned = stripToolCallMarkup(content);
  const heading = cleaned.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  const firstLine =
    heading ||
    cleaned
      .split(/\n+/)
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .find((line) => line.length > 0);

  if (!firstLine) return fallback;

  const normalized = firstLine
    .replace(/[*_`#>]/g, "")
    .replace(/[。！？.!?：:，,；;、]+$/g, "")
    .trim();

  if (!normalized) return fallback;
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}
