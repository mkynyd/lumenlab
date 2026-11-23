import { getRedis } from "@/lib/redis";
import {
  CHAT_INP_SCREENS,
  chatInpKey,
  recentUtcDays,
  summarizeChatInp,
  type ChatInpGroup,
  type ChatInpReport,
  type ChatInpScreen,
} from "./inp-metrics";

/**
 * Read the browser INP samples collected from intelligent UI visits.
 *
 * Keys expire on their UTC day + retention window, so a read only touches the
 * requested range. A missing or unreadable Redis instance returns an empty
 * report instead of failing the operator query.
 */
export async function getChatInpReport(days = 7, now: Date = new Date()): Promise<ChatInpReport> {
  const dayKeys = recentUtcDays(days, now);
  const groups: ChatInpGroup[] = [];
  const samplesByScreen: Record<ChatInpScreen, number[]> = { narrow: [], wide: [] };

  for (const day of dayKeys) {
    for (const screen of CHAT_INP_SCREENS) {
      const values = await readSamples(chatInpKey(day, screen));
      samplesByScreen[screen].push(...values);
      if (values.length > 0) {
        groups.push({ day, screen, ...summarizeChatInp(values) });
      }
    }
  }

  return {
    days: dayKeys.length,
    sinceDay: dayKeys[dayKeys.length - 1],
    untilDay: dayKeys[0],
    screens: {
      narrow: summarizeChatInp(samplesByScreen.narrow),
      wide: summarizeChatInp(samplesByScreen.wide),
    },
    groups,
  };
}

async function readSamples(key: string): Promise<number[]> {
  try {
    const rows = await getRedis().zrange(key, 0, -1, "WITHSCORES");
    const values: number[] = [];
    for (let index = 1; index < rows.length; index += 2) {
      const value = Number(rows[index]);
      if (Number.isFinite(value) && value >= 0) values.push(value);
    }
    return values;
  } catch {
    return [];
  }
}
