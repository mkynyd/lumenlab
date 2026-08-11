import Link from "next/link";
import { prisma } from "@/lib/db";
import { ErrorsTable, type ErrorRow } from "./errors-table";

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "", label: "全部" },
  { value: "open", label: "待处理" },
  { value: "resolved", label: "已解决" },
  { value: "ignored", label: "已忽略" },
];

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const items = await prisma.errorEvent.findMany({
    where: status ? { status } : {},
    orderBy: { lastSeenAt: "desc" },
    take: 100,
  });

  const rows: ErrorRow[] = items.map((item) => ({
    id: item.id,
    source: item.source,
    message: item.message,
    stack: item.stack,
    route: item.route,
    userId: item.userId,
    count: item.count,
    status: item.status,
    lastSeenAt: item.lastSeenAt.toISOString(),
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">错误事件</h1>
      <div className="flex gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value ? `/admin/errors?status=${filter.value}` : "/admin/errors"}
            className={
              (status ?? "") === filter.value
                ? "rounded-full bg-[var(--color-interaction-active)] px-3 py-1 font-medium"
                : "rounded-full px-3 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)]"
            }
          >
            {filter.label}
          </Link>
        ))}
      </div>
      <ErrorsTable rows={rows} />
    </div>
  );
}
