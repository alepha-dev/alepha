import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { MyFeedbackResource } from "@/api/schemas/myFeedbackResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import FeedbackThread from "../../project/feedback/FeedbackThread.tsx";
import QuestTagInput from "../../project/quest/QuestTagInput.tsx";

export interface MyFeedbackEditSheetProps {
  /**
   * The feedback being edited; `undefined` keeps the sheet closed.
   */
  feedback: MyFeedbackResource | undefined;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Inline drawer opened by clicking a row in {@link MyFeedback}. A pending
 * feedback is editable — title, description and tags via `updateMyFeedback`
 * (attachments are left as-is); a triaged (accepted/rejected) feedback renders
 * read-only.
 */
const MyFeedbackEditSheet = (props: MyFeedbackEditSheetProps) => {
  const feedbackApi = useClient<FeedbackController>();
  const toaster = useToast();
  const { tr } = useI18n<I18n, "en">();
  const [currentUser] = useStore(currentUserAtom);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Row click opens this drawer for any feedback, but editing is pending-only
  // (the server enforces it too). Non-pending feedback render read-only.
  const readOnly = !props.feedback || props.feedback.status !== "pending";
  const disabled = saving || readOnly;

  // Re-seed the form whenever a different feedback is opened. Adjusted during
  // render rather than from an effect, so the drawer never paints one frame of
  // the previous feedback's text.
  const [seededFrom, setSeededFrom] = useState(props.feedback);
  if (props.feedback && props.feedback !== seededFrom) {
    setSeededFrom(props.feedback);
    setTitle(props.feedback.title);
    setDescription(props.feedback.description);
    setTags(props.feedback.tags ?? []);
  }

  const save = async () => {
    if (!props.feedback) return;
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedDescription) {
      toaster.error(String(tr("myFeedback.edit.required")));
      return;
    }
    setSaving(true);
    try {
      await feedbackApi.updateMyFeedback({
        params: { feedbackId: props.feedback.id },
        body: { title: trimmedTitle, description: trimmedDescription, tags },
      });
      toaster.success(String(tr("myFeedback.edit.saved")));
      props.onSaved();
    } catch (error: any) {
      toaster.error(error?.message ?? String(tr("myFeedback.edit.error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={!!props.feedback}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>
            {readOnly
              ? tr("myFeedback.edit.title.readOnly")
              : tr("myFeedback.edit.title")}
          </SheetTitle>
          <SheetDescription>
            {readOnly
              ? tr("myFeedback.edit.hint.readOnly")
              : tr("myFeedback.edit.hint")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="feedback-title">
              {tr("myFeedback.column.title")}
            </label>
            <Input
              id="feedback-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={String(tr("myFeedback.edit.title.placeholder"))}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-sm font-medium"
              htmlFor="feedback-description"
            >
              {tr("myFeedback.edit.description")}
            </label>
            <Textarea
              id="feedback-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              maxLength={10000}
              placeholder={String(
                tr("myFeedback.edit.description.placeholder"),
              )}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              {tr("myFeedback.column.tags")}
            </span>
            <QuestTagInput
              value={tags}
              onChange={setTags}
              disabled={disabled}
            />
          </div>

          {/* The same thread the project owner sees. The reporter is
              usually not a member of the project, which is exactly why the
              comment endpoints gate on "member OR reporter of this item"
              rather than membership. Never the owner here, so no moderation
              controls. */}
          {props.feedback && (
            <div className="border-border border-t pt-4">
              <FeedbackThread
                feedbackId={props.feedback.id}
                currentUserId={currentUser?.id}
              />
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={props.onClose} disabled={saving}>
            {readOnly ? tr("common.close") : tr("common.cancel")}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {tr("common.save")}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default MyFeedbackEditSheet;
