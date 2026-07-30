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
import { useEffect, useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import { useQuestImageUpload } from "../../shared/markdown-editor/useQuestImageUpload.ts";

export interface QuestSummaryEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: string;
  submitting: boolean;
  /** Receives the new value (empty string = clear). Returns when persisted. */
  onSave: (message: string) => Promise<void>;
}

const QuestSummaryEditDialog = (props: QuestSummaryEditDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const imageUploadHandler = useQuestImageUpload();
  const [value, setValue] = useState(props.initialValue ?? "");

  // Re-prime when the dialog re-opens against a different quest / value.
  useEffect(() => {
    if (props.open) setValue(props.initialValue ?? "");
  }, [props.open, props.initialValue]);

  const handleSave = async () => {
    await props.onSave(value.trim());
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("quest.view.editSummary.title")}</DialogTitle>
          <DialogDescription>
            {tr("quest.view.editSummary.description")}
          </DialogDescription>
        </DialogHeader>
        <MarkdownEditor
          value={value}
          onChange={setValue}
          placeholder={tr("quest.view.complete.placeholder")}
          imageUploadHandler={imageUploadHandler}
          minHeight={200}
        />
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={props.submitting}
            onClick={() => props.onOpenChange(false)}
          >
            {tr("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={props.submitting}
            onClick={handleSave}
          >
            {tr("quest.view.editSummary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuestSummaryEditDialog;
