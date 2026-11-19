import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityList } from "@/components/activity-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listActivity } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="Every step the workflow recorded, newest first. Run links open the trace in Trigger.dev."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" aria-busy="true" />}>
        <Activity />
      </Suspense>
    </>
  );
}

async function Activity() {
  const user = await requireUser();
  const entries = await listActivity(user.id, 200);
  return (
    <Card>
      <CardContent>
        <ActivityList entries={entries} now={new Date()} />
      </CardContent>
    </Card>
  );
}
