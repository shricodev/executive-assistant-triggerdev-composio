"use client";

import { useRealtimeRun } from "@trigger.dev/react-hooks";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Subscribes to the workflow run over Trigger.dev Realtime while it is
 * executing and refreshes the server-rendered page when the run moves on.
 */
export function RunWatcher({ runId, accessToken }: { runId: string; accessToken: string }) {
  const router = useRouter();
  const { run } = useRealtimeRun(runId, { accessToken });
  const stage = typeof run?.metadata?.stage === "string" ? run.metadata.stage : undefined;
  const status = run?.status;

  useEffect(() => {
    if (stage || status) router.refresh();
  }, [router, stage, status]);

  return null;
}
