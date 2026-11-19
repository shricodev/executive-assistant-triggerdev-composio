import "server-only";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  actions,
  activity,
  approvals,
  requests,
  type ApprovalStatus,
  type RequestStatus,
} from "@/db/schema";
import { appEnv } from "@/env";

// Every function here takes the signed-in user's id and filters by it. Pages
// never query these tables directly.

export type DisplayStatus = Exclude<RequestStatus, "proposed"> | ApprovalStatus;

export function runUrl(runId: string | null) {
  const project = appEnv().TRIGGER_PROJECT_REF;
  if (!runId || !project) return null;
  return `https://cloud.trigger.dev/projects/v3/${project}/runs/${runId}`;
}

/** Latest proposal version per request, keyed by request id. */
async function latestApprovals(userId: string, requestIds: string[]) {
  if (requestIds.length === 0) return new Map<string, { id: string; status: ApprovalStatus }>();
  const rows = await db
    .select({
      id: approvals.id,
      requestId: approvals.requestId,
      status: approvals.status,
      version: approvals.version,
    })
    .from(approvals)
    .where(and(eq(approvals.userId, userId), inArray(approvals.requestId, requestIds)))
    .orderBy(approvals.version);
  return new Map(rows.map((row) => [row.requestId, { id: row.id, status: row.status }]));
}

export async function listRequests(userId: string, limit: number) {
  const rows = await db
    .select()
    .from(requests)
    .where(eq(requests.userId, userId))
    .orderBy(desc(requests.createdAt))
    .limit(limit);
  const latest = await latestApprovals(
    userId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => {
    const approval = latest.get(row.id);
    const status: DisplayStatus =
      row.status === "proposed" ? (approval?.status ?? "processing") : row.status;
    return { ...row, displayStatus: status, approvalId: approval?.id ?? null };
  });
}

export async function getCounts(userId: string) {
  const [byApproval, byRequest] = await Promise.all([
    db
      .select({ status: approvals.status, total: count() })
      .from(approvals)
      .where(eq(approvals.userId, userId))
      .groupBy(approvals.status),
    db
      .select({ status: requests.status, total: count() })
      .from(requests)
      .where(eq(requests.userId, userId))
      .groupBy(requests.status),
  ]);
  const approval = (status: ApprovalStatus) =>
    byApproval.find((row) => row.status === status)?.total ?? 0;
  const request = (status: RequestStatus) =>
    byRequest.find((row) => row.status === status)?.total ?? 0;

  return {
    pending: approval("pending"),
    completed: approval("completed"),
    failed: approval("failed") + request("failed"),
    skipped: request("skipped"),
    received: byRequest.reduce((sum, row) => sum + row.total, 0),
  };
}

export async function countPending(userId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(approvals)
    .where(and(eq(approvals.userId, userId), eq(approvals.status, "pending")));
  return row?.total ?? 0;
}

export async function listApprovals(userId: string, scope: "pending" | "all") {
  return db
    .select({
      id: approvals.id,
      status: approvals.status,
      version: approvals.version,
      proposal: approvals.proposal,
      expiresAt: approvals.expiresAt,
      createdAt: approvals.createdAt,
      senderEmail: requests.senderEmail,
      senderName: requests.senderName,
      subject: requests.subject,
    })
    .from(approvals)
    .innerJoin(requests, eq(requests.id, approvals.requestId))
    .where(
      and(
        eq(approvals.userId, userId),
        scope === "pending"
          ? eq(approvals.status, "pending")
          : ne(approvals.status, "superseded"),
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(100);
}

export async function getApprovalDetail(userId: string, approvalId: string) {
  const [row] = await db
    .select({ approval: approvals, request: requests })
    .from(approvals)
    .innerJoin(requests, eq(requests.id, approvals.requestId))
    .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
    .limit(1);
  if (!row) return null;

  const [actionRows, newer] = await Promise.all([
    db.select().from(actions).where(eq(actions.approvalId, approvalId)).orderBy(actions.kind),
    db
      .select({ id: approvals.id, version: approvals.version })
      .from(approvals)
      .where(and(eq(approvals.requestId, row.request.id), eq(approvals.userId, userId)))
      .orderBy(desc(approvals.version))
      .limit(1),
  ]);

  return {
    ...row,
    actions: actionRows,
    replacement: newer[0] && newer[0].version > row.approval.version ? newer[0].id : null,
  };
}

export async function listActivity(userId: string, limit: number) {
  const rows = await db
    .select({
      id: activity.id,
      type: activity.type,
      message: activity.message,
      runId: activity.runId,
      createdAt: activity.createdAt,
      requestId: activity.requestId,
      subject: requests.subject,
    })
    .from(activity)
    .leftJoin(requests, eq(requests.id, activity.requestId))
    .where(eq(activity.userId, userId))
    .orderBy(desc(activity.createdAt))
    .limit(limit);

  const latest = await latestApprovals(
    userId,
    rows.flatMap((row) => (row.requestId ? [row.requestId] : [])),
  );
  return rows.map((row) => ({
    ...row,
    approvalId: row.requestId ? (latest.get(row.requestId)?.id ?? null) : null,
  }));
}
