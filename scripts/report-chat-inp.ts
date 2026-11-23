import { CHAT_INP_RETENTION_DAYS } from "@/lib/chat/intelligent-ui/inp-metrics";
import { getChatInpReport } from "@/lib/chat/intelligent-ui/inp-store";
import { getRedis } from "@/lib/redis";

async function main() {
  const requested = Number(process.argv[2] ?? 7);
  const days = Number.isFinite(requested) ? requested : 7;
  const report = await getChatInpReport(days);
  const format = (value: number | null) => (value === null ? "-" : `${Math.round(value)} ms`);

  console.log(
    `Chat intelligent UI INP · ${report.sinceDay} .. ${report.untilDay} (${report.days} days, retention ${CHAT_INP_RETENTION_DAYS} days)`
  );
  console.log("");
  console.log("screen\tcount\tp50\tp75\tp95");
  for (const screen of ["narrow", "wide"] as const) {
    const summary = report.screens[screen];
    console.log(
      [screen, summary.count, format(summary.p50), format(summary.p75), format(summary.p95)].join("\t")
    );
  }
  console.log("");
  console.log("day\tscreen\tcount\tp50\tp75\tp95");
  for (const group of report.groups) {
    console.log(
      [group.day, group.screen, group.count, format(group.p50), format(group.p75), format(group.p95)].join("\t")
    );
  }
  if (report.screens.narrow.count + report.screens.wide.count === 0) {
    console.log("");
    console.log("No samples yet. Traffic only reports from pages that rendered an intelligent UI surface.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    getRedis().disconnect();
  });
