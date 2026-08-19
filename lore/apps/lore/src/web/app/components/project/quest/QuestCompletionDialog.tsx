import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Swords } from "lucide-react";
import { useState } from "react";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import LoreEditor from "../../shared/element/LoreEditor.tsx";

export interface QuestCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onConfirm: (message: string | undefined) => void;
}

const QuestCompletionDialog = (props: QuestCompletionDialogProps) => {
  // The links the editor's View mode produces are URLs, so it needs the slug.
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const [message, setMessage] = useState("");

  const handleClose = (open: boolean) => {
    if (!open) {
      setMessage("");
    }
    props.onOpenChange(open);
  };

  const completeWith = () => {
    const trimmed = message.trim();
    props.onConfirm(trimmed.length > 0 ? trimmed : undefined);
  };

  const completeWithout = () => {
    props.onConfirm(undefined);
  };

  return (
    <Dialog open={props.open} onOpenChange={handleClose}>
      {/*
        `3xl` rather than `xl`: the editor's toolbar wants ~810px and a
        completion summary is worth the room. This is the cosmetic half of
        #171 — the fix that matters is `min-w-0` on the editor wrapper plus a
        scrollable toolbar, without which a wider dialog only moves the
        breakpoint to a narrower viewport.
      */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tr("quest.view.complete.title")}</DialogTitle>
          <DialogDescription>
            {tr("quest.view.complete.description")}
          </DialogDescription>
        </DialogHeader>
        <LoreEditor
          element={{
            kind: "quest",
            projectId: project?.id ?? 0,
            projectSlug: project?.slug ?? "",
          }}
          value={message}
          onChange={setMessage}
          placeholder={tr("quest.view.complete.placeholder")}
          minHeight={200}
        />
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={completeWithout}
            disabled={props.submitting}
          >
            {tr("quest.view.complete.skip")}
          </Button>
          <Button
            type="button"
            onClick={completeWith}
            disabled={props.submitting || message.trim().length === 0}
            className="bg-green-600 text-white hover:bg-green-700"
          >
            <Swords className="size-4" />
            {tr("quest.view.complete.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuestCompletionDialog;
