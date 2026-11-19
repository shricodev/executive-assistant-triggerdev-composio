import { auth } from "@trigger.dev/sdk";
import {
  ArrowLeft,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  FileText,
  Mail,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionKind } from "@/db/schema";
import { COMPANY_DOCUMENTS, type DocumentId } from "@/lib/agent/company-context";
import { formatDateTime, formatTimeRange, INTENT_LABELS, timeAgo } from "@/lib/format";
import { getApprovalDetail, runUrl } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { DecisionPanel } from "./decision-panel";
import { RunWatcher } from "./run-watcher";

export const metadata: Metadata = { title: "Review proposal" };

export default function ApprovalPage({ params }: PageProps<"/approvals/[id]">) {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
        <Link href="/approvals">
          <ArrowLeft aria-hidden /> Approvals
        </Link>
      </Button>
      <Suspense fallback={<DetailSkeleton />}>
        <ApprovalDetail params={params} />
      </Suspense>
    </>
  );
}

const ACTION_LABELS: Record<ActionKind, { todo: string; done: string; icon: typeof Mail }> = {
  create_event: { todo: "Create calendar event and send invite", done: "Calendar event created", icon: CalendarClock },
  send_email: { todo: "Send reply", done: "Reply sent", icon: Mail },
};

async function realtimeToken(runId: string) {
  try {
    return await auth.createPublicToken({
      scopes: { read: { runs: [runId] } },
      expirationTime: "1h",
    });
  } catch {
    return null;
  }
}

async function ApprovalDetail({ params }: Pick<PageProps<"/approvals/[id]">, "params">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [detail, settings] = await Promise.all([
    getApprovalDetail(user.id, id),
    getSettings(user.id),
  ]);
  if (!detail) notFound();

  const { approval, request, actions } = detail;
  const { proposal } = approval;
  const now = new Date();
  const inFlight = approval.status === "approved" || approval.status === "executing";
  const token = inFlight && request.runId ? await realtimeToken(request.runId) : null;
  const traceUrl = runUrl(request.runId);
  const meeting = proposal.meeting
    ? { ...proposal.meeting, ...formatTimeRange(proposal.meeting.start, proposal.meeting.end, proposal.meeting.timezone) }
    : null;

  return (
    <div className="space-y-6">
      {token && request.runId && <RunWatcher runId={request.runId} accessToken={token} />}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={approval.status} />
          <Badge variant="secondary">{INTENT_LABELS[proposal.intent]}</Badge>
          {proposal.priority === "high" && <Badge variant="destructive">Escalation</Badge>}
          {approval.version > 1 && <Badge variant="outline">Revision {approval.version}</Badge>}
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-balance">{request.subject}</h1>
        <p className="text-sm text-muted-foreground">{proposal.summary}</p>
      </header>

      {approval.status === "failed" && approval.failureReason && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>Not everything was completed</AlertTitle>
          <AlertDescription>{approval.failureReason}</AlertDescription>
        </Alert>
      )}
      {approval.status === "superseded" && (
        <Alert>
          <CircleAlert aria-hidden />
          <AlertTitle>Nothing was sent</AlertTitle>
          <AlertDescription>
            {approval.failureReason}{" "}
            {detail.replacement && (
              <Link href={`/approvals/${detail.replacement}`} className="font-medium underline underline-offset-4">
                Review the new proposal
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardDescription>Original email</CardDescription>
              <CardTitle className="text-base">
                {request.senderName ?? request.senderEmail}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {request.senderName && <>{request.senderEmail} · </>}
                <time dateTime={request.receivedAt.toISOString()}>
                  {formatDateTime(request.receivedAt, settings.timezone)}
                </time>
              </p>
            </CardHeader>
            <CardContent>
              <p className="max-h-80 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {request.body}
              </p>
            </CardContent>
          </Card>

          <Card className="border-foreground/20">
            <CardHeader>
              <CardDescription>Proposed reply</CardDescription>
              <CardTitle className="text-base">{proposal.email.subject}</CardTitle>
              <p className="text-sm text-muted-foreground">To {proposal.email.to}</p>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{proposal.email.body}</p>
            </CardContent>
          </Card>

          {meeting && (
            <Card>
              <CardHeader>
                <CardDescription>Proposed meeting</CardDescription>
                <CardTitle className="text-base">{meeting.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="font-medium">{meeting.day}</p>
                    <p className="text-muted-foreground">
                      {meeting.time} · {meeting.minutes} min · {meeting.timezone}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p>{meeting.attendees.join(", ")}</p>
                </div>
                {meeting.description && (
                  <p className="border-l-2 pl-3 text-muted-foreground">{meeting.description}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {approval.status === "pending" ? "Your decision" : "Outcome"}
              </CardTitle>
              <CardDescription>
                {approval.status === "pending"
                  ? `Expires ${timeAgo(approval.expiresAt, now)}. The workflow is paused until you decide.`
                  : outcomeText(approval.status, approval.decidedAt, settings.timezone)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                {proposal.actions.map((kind) => {
                  const action = actions.find((item) => item.kind === kind);
                  const label = ACTION_LABELS[kind];
                  const link =
                    action?.status === "succeeded"
                      ? kind === "send_email"
                        ? `https://mail.google.com/mail/u/0/#all/${action.result?.threadId ?? proposal.email.threadId}`
                        : action.result?.url
                      : undefined;
                  return (
                    <li key={kind} className="flex items-start gap-2.5 text-sm">
                      <ActionIcon status={action?.status} />
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium">
                          {action?.status === "succeeded" ? label.done : label.todo}
                        </p>
                        {action?.status === "failed" && (
                          <p className="text-destructive">{action.error}</p>
                        )}
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
                          >
                            Open in {kind === "send_email" ? "Gmail" : "Calendar"}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {approval.status === "pending" && (
                <>
                  <Separator />
                  <DecisionPanel
                    approvalId={approval.id}
                    proposalHash={approval.proposalHash}
                    recipient={proposal.email.to}
                    hasMeeting={Boolean(proposal.meeting)}
                  />
                </>
              )}
              {approval.decisionNote && (
                <p className="border-l-2 pl-3 text-sm text-muted-foreground">{approval.decisionNote}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Context used</CardTitle>
              <CardDescription>Company documents the assistant read for this reply.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {proposal.sources.map((id) => (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {COMPANY_DOCUMENTS[id as DocumentId]?.title ?? id}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {traceUrl && (
            <Button asChild variant="outline" size="sm" className="w-full">
              <a href={traceUrl} target="_blank" rel="noreferrer">
                View run in Trigger.dev <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}

function outcomeText(status: string, decidedAt: Date | null, timezone: string) {
  const when = decidedAt ? ` on ${formatDateTime(decidedAt, timezone)}` : "";
  switch (status) {
    case "approved":
    case "executing":
      return `Approved${when}. Carrying out the actions now.`;
    case "completed":
      return `Approved${when}. Everything below was carried out.`;
    case "failed":
      return `Approved${when}, but the actions did not all complete.`;
    case "rejected":
      return `Rejected${when}. Nothing was sent.`;
    case "expired":
      return "Expired without a decision. Nothing was sent.";
    default:
      return "Replaced by a newer proposal. Nothing was sent.";
  }
}

function ActionIcon({ status }: { status?: string }) {
  if (status === "succeeded") {
    return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />;
  }
  if (status === "failed") {
    return <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />;
  }
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-2/3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}
