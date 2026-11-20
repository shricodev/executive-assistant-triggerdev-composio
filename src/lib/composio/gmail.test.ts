import { describe, expect, it, vi } from "vitest";
import { ToolError, type ComposioSession } from "./client";
import { createReplyDraft, getDraft, sendDraft } from "./gmail";

// Response shapes below are the ones the live Composio tools returned.
function sessionReturning(result: { data?: unknown; error?: string; resultType?: string }) {
  const execute = vi.fn(async () => ({ data: {}, error: null, resultType: "completed", ...result }));
  return { session: { execute } as unknown as ComposioSession, execute };
}

const reply = { to: "dana@example.com", subject: "Re: Pricing", body: "Hello", threadId: "thread_1" };

describe("Gmail draft responses", () => {
  it("reads the message id from a created draft", async () => {
    const { session, execute } = sessionReturning({
      data: { id: "r-1", message: { id: "msg_1", threadId: "thread_1", labelIds: ["DRAFT"] } },
    });

    expect(await createReplyDraft(session, reply)).toEqual({ draftId: "r-1", messageId: "msg_1" });
    expect(execute).toHaveBeenCalledWith(
      "GMAIL_CREATE_EMAIL_DRAFT",
      expect.objectContaining({ recipient_email: "dana@example.com", thread_id: "thread_1" }),
    );
  });

  it("reads the same message id from a fetched draft, which names it differently", async () => {
    const { session } = sessionReturning({
      data: { id: "r-1", message: { messageId: "msg_1", threadId: "thread_1", labelIds: ["DRAFT"] } },
    });

    expect(await getDraft(session, "r-1")).toEqual({ draftId: "r-1", messageId: "msg_1" });
  });

  it("returns null for a draft that was sent or deleted", async () => {
    const { session } = sessionReturning({
      resultType: "failed",
      error: "Draft not found: The draft_id 'r-1' does not exist or has already been sent/deleted.",
      data: { message: "Draft not found", status_code: 404 },
    });

    expect(await getDraft(session, "r-1")).toBeNull();
  });

  it("names the tool and the field when a response does not fit", async () => {
    const { session } = sessionReturning({ data: { id: "r-1", message: { threadId: "thread_1" } } });

    const error = await getDraft(session, "r-1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as Error).message).toContain("GMAIL_GET_DRAFT: unexpected response");
    expect((error as Error).message).toContain("message id is missing");
  });

  it("accepts either id name for a sent message", async () => {
    const byId = sessionReturning({ data: { id: "msg_2", threadId: "thread_1" } });
    const byMessageId = sessionReturning({ data: { messageId: "msg_2", threadId: "thread_1" } });

    expect(await sendDraft(byId.session, "r-1")).toEqual({ messageId: "msg_2", threadId: "thread_1" });
    expect(await sendDraft(byMessageId.session, "r-1")).toEqual({ messageId: "msg_2", threadId: "thread_1" });
  });
});
