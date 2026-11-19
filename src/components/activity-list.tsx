import {
  CalendarCheck,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  Plug,
  Send,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { runUrl } from "@/lib/queries";

const ICONS: Record<string, LucideIcon> = {
  "email.received": Mail,
  "email.skipped": CircleSlash,
  "proposal.created": FileText,
  "approval.approved": CircleCheck,
  "approval.rejected": CircleX,
  "approval.expired": Clock,
  "approval.superseded": CircleAlert,
  "action.succeeded": Send,
  "action.failed": CircleAlert,
  "workflow.failed": CircleAlert,
  "connection.created": Plug,
  "connection.removed": Plug,
};

export type ActivityEntry = {
  id: string;
  type: string;
  message: string;
  runId: string | null;
  createdAt: Date;
  subject: string | null;
  approvalId: string | null;
};

export function ActivityList({ entries, now }: { entries: ActivityEntry[]; now: Date }) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="divide-y">
      {entries.map((entry) => {
        const Icon = entry.message.startsWith("Calendar event created")
          ? CalendarCheck
          : (ICONS[entry.type] ?? Clock);
        const failed = entry.type.endsWith("failed");
        const trace = runUrl(entry.runId);
        return (
          <li key={entry.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${failed ? "text-destructive" : "text-muted-foreground"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm">{entry.message}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <time dateTime={entry.createdAt.toISOString()} title={entry.createdAt.toISOString()}>
                  {timeAgo(entry.createdAt, now)}
                </time>
                {entry.subject &&
                  (entry.approvalId ? (
                    <Link href={`/approvals/${entry.approvalId}`} className="truncate underline-offset-4 hover:underline">
                      {entry.subject}
                    </Link>
                  ) : (
                    <span className="truncate">{entry.subject}</span>
                  ))}
              </p>
            </div>
            {trace && (
              <a
                href={trace}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Run <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
