/**
 * Chat intelligent UI — browser INP sampling contract.
 *
 * Only page visits that rendered an intelligent UI surface report a single
 * Interaction to Next Paint sample. The sample carries no user identity, route
 * or interaction target: just a random visit id, the UTC day and the screen
 * class. The same visit id may be reported more than once (web-vitals can
 * refine the value before the page is hidden); Redis keeps one score per id.
 */

export const CHAT_INP_RETENTION_DAYS = 14;
export const CHAT_INP_KEY_PREFIX = "lumenlab:chat-inp:v1";
export const CHAT_INP_SCREENS = ["narrow", "wide"] as const;

export type ChatInpScreen = (typeof CHAT_INP_SCREENS)[number];

export interface ChatInpSummary {
  count: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface ChatInpGroup extends ChatInpSummary {
  day: string;
  screen: ChatInpScreen;
}

export interface ChatInpReport {
  days: number;
  sinceDay: string;
  untilDay: string;
  screens: Record<ChatInpScreen, ChatInpSummary>;
  groups: ChatInpGroup[];
}

export function chatInpKey(day: string, screen: ChatInpScreen): string {
  return `${CHAT_INP_KEY_PREFIX}:${day}:${screen}`;
}

export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function recentUtcDays(days: number, now: Date = new Date()): string[] {
  const count = Math.min(CHAT_INP_RETENTION_DAYS, Math.max(1, Math.floor(days)));
  return Array.from({ length: count }, (_, offset) =>
    utcDay(new Date(now.getTime() - offset * 86_400_000))
  );
}

/**
 * Nearest-rank percentile over an unsorted sample. Returns null for an empty
 * sample so callers can distinguish "not enough traffic yet" from 0 ms.
 */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(Math.min(1, Math.max(0, fraction)) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarizeChatInp(values: readonly number[]): ChatInpSummary {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
  };
}
