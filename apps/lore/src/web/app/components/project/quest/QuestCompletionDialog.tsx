import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { SquareSlash, Swords } from "lucide-react";
import { useState } from "react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import LoreEditor from "../../shared/element/LoreEditor.tsx";

export interface QuestCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  /**
   * Objectives still unticked. Each needs a reason before the quest can
   * close, and the reason is stored on the objective rather than folded
   * into the summary.
   */
  unticked: QuestResource["objectives"];
  onConfirm: (
    message: string | undefined,
    waive: Array<{ objectiveId: number; reason: string }>,
  ) => void;
}

const QuestCompletionDialog = (props: QuestCompletionDialogProps) => {
  // The links the editor's View mode produces are URLs, so it needs the slug.
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const [message, setMessage] = useState("");
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const handleClose = (open: boolean) => {
    if (!open) {
      setMessage("");
      setReasons({});
    }
    props.onOpenChange(open);
  };

  // Every unticked objective needs a reason. The alternative the server used
  // to force was ticking a box for work nobody did, and a false tick is
  // indistinguishable from a real one forever after.
  const waivers = props.unticked.map((objective) => ({
    objectiveId: objective.id,
    reason: (reasons[objective.id] ?? "").trim(),
  }));
  const waiversIncomplete = waivers.some((waiver) => !waiver.reason);

  const confirm = (withMessage: boolean) => {
    const trimmed = message.trim();
    props.onConfirm(
      withMessage && trimmed.length > 0 ? trimmed : undefined,
      waivers,
    );
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

        {/* Above the summary: what was skipped is the question a reader of
            this quest asks first, and answering it is also what unlocks the
            button. */}
        {props.unticked.length > 0 && (
          <div className="border-border flex flex-col gap-3 rounded-md border px-3 py-3">
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <SquareSlash className="mt-0.5 size-3.5 shrink-0" />
              <span>{tr("quest.view.complete.waive.hint")}</span>
            </p>
            {props.unticked.map((objective) => (
              <label key={objective.id} className="flex flex-col gap-1">
                <span className="text-sm">{objective.title}</span>
                <Input
                  value={reasons[objective.id] ?? ""}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [objective.id]: event.target.value,
                    }))
                  }
                  placeholder={String(
                    tr("quest.view.complete.waive.placeholder"),
                  )}
                  disabled={props.submitting}
                />
              </label>
            ))}
          </div>
        )}

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
            onClick={() => confirm(false)}
            disabled={props.submitting || waiversIncomplete}
          >
            {tr("quest.view.complete.skip")}
          </Button>
          <Button
            type="button"
            onClick={() => confirm(true)}
            disabled={
              props.submitting ||
              message.trim().length === 0 ||
              waiversIncomplete
            }
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
