"use client";

import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { decideApproval } from "../actions";

type Props = {
  approvalId: string;
  proposalHash: string;
  recipient: string;
  hasMeeting: boolean;
};

export function DecisionPanel({ approvalId, proposalHash, recipient, hasMeeting }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  function submit(decision: "approved" | "rejected") {
    startTransition(async () => {
      const result = await decideApproval({
        approvalId,
        proposalHash,
        decision,
        note: decision === "rejected" ? note : undefined,
      });
      setRejectOpen(false);
      if (result.ok) {
        toast.success(decision === "approved" ? "Approved. Sending now." : "Rejected. Nothing was sent.");
      } else {
        toast.error(result.message);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={pending} className="w-full">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Approve and send
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this reply?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasMeeting
                ? `The reply will be sent to ${recipient} and a calendar invite will be created. Availability is checked again first.`
                : `The reply will be sent to ${recipient} exactly as shown.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => submit("approved")}>Approve and send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" disabled={pending} className="w-full">
            <X aria-hidden /> Reject
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this proposal?</DialogTitle>
            <DialogDescription>
              Nothing will be sent and the Gmail draft will be deleted. You can still reply yourself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Why this was rejected"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => submit("rejected")}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
