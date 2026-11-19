import { ArrowRight, Inbox, Plug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityList } from "@/components/activity-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getConnections } from "@/lib/composio/connections";
import { INTENT_LABELS, timeAgo } from "@/lib/format";
import { getCounts, listActivity, listRequests } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Incoming email, what the assistant proposed, and what happened to it."
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  const user = await requireUser();
  const [counts, recent, activity, connections] = await Promise.all([
    getCounts(user.id),
    listRequests(user.id, 8),
    listActivity(user.id, 6),
    getConnections(user.id),
  ]);
  const now = new Date();

  const stats = [
    { label: "Needs approval", value: counts.pending, href: "/approvals" },
    { label: "Completed", value: counts.completed, href: "/approvals?view=all" },
    { label: "Failed", value: counts.failed, href: "/activity" },
    { label: "Skipped", value: counts.skipped, href: "/activity" },
  ];

  return (
    <div className="space-y-6">
      {!connections.gmail && (
        <EmptyState
          icon={Plug}
          title="Connect Gmail to get started"
          description="The assistant starts working when a new message arrives in the connected inbox."
          action={
            <Button asChild size="sm">
              <Link href="/settings">Open settings</Link>
            </Button>
          }
        />
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-card p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
          >
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{stat.value}</dd>
          </Link>
        ))}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent requests</CardTitle>
          <CardDescription>
            {counts.received === 0
              ? "No email has reached the assistant yet."
              : `${counts.received} email${counts.received === 1 ? "" : "s"} handled so far.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Waiting for the first email"
              description="Send a message to the connected inbox. It arrives here through the Composio webhook within moments."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden md:table-cell">Intent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="max-w-40 truncate font-medium">
                      {request.senderName ?? request.senderEmail}
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {request.approvalId ? (
                        <Link
                          href={`/approvals/${request.approvalId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {request.subject}
                        </Link>
                      ) : (
                        <span title={request.error ?? request.summary ?? undefined}>{request.subject}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {request.intent ? INTENT_LABELS[request.intent] : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={request.displayStatus} />
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                      {timeAgo(request.receivedAt, now)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Activity</CardTitle>
            <CardDescription>The latest steps taken by the workflow.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/activity">
              View all <ArrowRight aria-hidden />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <ActivityList entries={activity} now={now} />
        </CardContent>
      </Card>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
