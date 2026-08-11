import Link from "next/link";
import { prisma } from "@/lib/db";
import { FeedbackTable, type FeedbackRow } from "./feedback-table";

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "", label: "全部" },
  { value: "open", label: "待处理" },
  { value: "resolved", label: "已处理" },
  { value: "closed", label: "已关闭" },
];

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const items = await prisma.feedback.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { email: true, name: true } } },
  });

  const rows: FeedbackRow[] = items.map((item) => ({
    id: item.id,
    email: item.user.email,
    category: item.category,
    content: item.content,
    contact: item.contact,
    pagePath: item.pagePath,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">用户反馈</h1>
      <div className="flex gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value ? `/admin/feedback?status=${filter.value}` : "/admin/feedback"}
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
      <FeedbackTable rows={rows} />
    </div>
  );
}
