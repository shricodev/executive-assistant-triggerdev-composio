import { Badge } from "@/components/ui/badge";
import type { DisplayStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STATUS: Record<DisplayStatus, { label: string; tone: string; pulse?: boolean }> = {
  processing: { label: "Processing", tone: "text-info", pulse: true },
  pending: { label: "Needs approval", tone: "text-warning" },
  approved: { label: "Approved", tone: "text-info", pulse: true },
  executing: { label: "Executing", tone: "text-info", pulse: true },
  completed: { label: "Completed", tone: "text-success" },
  failed: { label: "Failed", tone: "text-destructive" },
  rejected: { label: "Rejected", tone: "text-muted-foreground" },
  expired: { label: "Expired", tone: "text-muted-foreground" },
  superseded: { label: "Replaced", tone: "text-muted-foreground" },
  skipped: { label: "Skipped", tone: "text-muted-foreground" },
};

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  const { label, tone, pulse } = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", className)}>
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full bg-current", tone, pulse && "animate-pulse")}
      />
      {label}
    </Badge>
  );
}
