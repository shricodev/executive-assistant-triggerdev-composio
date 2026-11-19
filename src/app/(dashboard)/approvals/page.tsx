import { CalendarClock, ChevronRight, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { INTENT_LABELS, timeAgo } from "@/lib/format";
import { listApprovals } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Nothing is sent and no event is created until you approve it here."
      />
      <Suspense fallback={<ListSkeleton />}>
        <ApprovalList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ApprovalList({ searchParams }: Pick<PageProps<"/approvals">, "searchParams">) {
  const user = await requireUser();
  const scope = (await searchParams).view === "all" ? "all" : "pending";
  const rows = await listApprovals(user.id, scope);
  const now = new Date();

  return (
    <div className="space-y-4">
      <nav aria-label="Filter approvals" className="flex gap-1">
        {(["pending", "all"] as const).map((view) => (
          <Button
            key={view}
            asChild
            size="sm"
            variant={scope === view ? "secondary" : "ghost"}
            aria-current={scope === view ? "page" : undefined}
          >
            <Link href={view === "pending" ? "/approvals" : "/approvals?view=all"}>
              {view === "pending" ? "Needs approval" : "All"}
            </Link>
          </Button>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={scope === "pending" ? "Nothing is waiting for you" : "No proposals yet"}
          description={
            scope === "pending"
              ? "When an email needs a reply, the proposed response appears here for review."
              : "Proposals appear here once the assistant has drafted a reply to an incoming email."
          }
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/approvals/${row.id}`}
                className="flex items-center gap-4 px-4 py-3.5 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium">{row.subject}</p>
                    {row.proposal.priority === "high" && <Badge variant="destructive">Escalation</Badge>}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {row.senderName ?? row.senderEmail} · {row.proposal.summary}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{INTENT_LABELS[row.proposal.intent]}</span>
                    {row.proposal.meeting && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3" aria-hidden /> Includes a meeting
                      </span>
                    )}
                    <span>{timeAgo(row.createdAt, now)}</span>
                    {row.status === "pending" && (
                      <span className={cn(row.expiresAt.getTime() - now.getTime() < 3_600_000 && "text-warning")}>
                        Expires {timeAgo(row.expiresAt, now)}
                      </span>
                    )}
                  </div>
                </div>
                <StatusBadge status={row.status} className="shrink-0" />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
