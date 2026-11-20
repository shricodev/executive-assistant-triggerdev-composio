"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { editReply } from "../actions";

type Props = {
  approvalId: string;
  proposalHash: string;
  body: string;
  maxLength: number;
  hasMeeting: boolean;
};

export function EditReply({ approvalId, proposalHash, body, maxLength, hasMeeting }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(body);
  const [pending, startTransition] = useTransition();
  const unchanged = text.trim() === body.trim();

  function save() {
    startTransition(async () => {
      const result = await editReply({ approvalId, proposalHash, body: text });
      if (!result.ok) {
        toast.error(result.message);
        router.refresh();
        return;
      }
      setOpen(false);
      if (result.changed) {
        toast.success("Reply updated. The Gmail draft was replaced.");
        router.replace(`/approvals/${result.approvalId}`);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setText(body);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil aria-hidden /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit reply</DialogTitle>
          <DialogDescription>
            Saving replaces the proposal and its Gmail draft with your wording. Nothing is sent
            until you approve it.
            {hasMeeting && " The meeting time is not changed by editing the text."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reply-body">Reply</Label>
          <Textarea
            id="reply-body"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={maxLength}
            disabled={pending}
            className="max-h-[50vh] min-h-72 text-sm leading-relaxed"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={save} disabled={pending || unchanged || !text.trim()}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
