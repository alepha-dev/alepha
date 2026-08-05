import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useI18n } from "alepha/react/i18n";
import { Swords } from "lucide-react";
import { useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import { useQuestImageUpload } from "../../shared/markdown-editor/useQuestImageUpload.ts";

export interface QuestCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onConfirm: (message: string | undefined) => void;
}

const QuestCompletionDialog = (props: QuestCompletionDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const imageUploadHandler = useQuestImageUpload();
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("quest.view.complete.title")}</DialogTitle>
          <DialogDescription>
            {tr("quest.view.complete.description")}
          </DialogDescription>
        </DialogHeader>
        <MarkdownEditor
          value={message}
          onChange={setMessage}
          placeholder={tr("quest.view.complete.placeholder")}
          imageUploadHandler={imageUploadHandler}
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
