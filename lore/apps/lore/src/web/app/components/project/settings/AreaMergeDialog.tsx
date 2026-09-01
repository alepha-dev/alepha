import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * The picker's own one-field form. `targetId` stays in React state as well,
 * because two things outside the control read it: the confirmation sentence
 * and the disabled Submit button.
 */
const mergeFormSchema = z.object({
  targetId: z.number().optional(),
});

export interface AreaMergeDialogProps {
  open: boolean;
  sources: AreaResource[];
  candidates: AreaResource[];
  onClose: () => void;
  onMerged: () => void;
}

/**
 * Bulk-merge toolbar dialog: collapses every selected source area into
 * one target area in a single call. This is what turns the 86-into-22
 * cleanup into one sitting instead of one rename-onto-collision dialog
 * per pair.
 *
 * `candidates` is `props.areas` with the selected sources already
 * filtered out by the caller: merging a set into one of its own members
 * is refused server-side, so the picker never offers it.
 */
const AreaMergeDialog = (props: AreaMergeDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const areaApi = useClient<AreaController>();
  const [project] = useStore(currentProjectAtom);
  const [targetId, setTargetId] = useState<number | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // `keepDirty: false` so `close()`'s reset actually reaches the trigger:
  // with the default the picked value is treated as an unsaved edit and kept
  // across the re-seed, and the dialog reopens still showing it.
  const form = useForm({
    schema: mergeFormSchema,
    initialValues: { targetId },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, value) => setTargetId(value as number | undefined),
  });

  const target = props.candidates.find((c) => c.id === targetId);
  const movingQuests = props.sources.reduce((n, a) => n + a.questCount, 0);

  const close = () => {
    setTargetId(undefined);
    props.onClose();
  };

  const submit = async () => {
    if (!project || !targetId) return;
    setSubmitting(true);
    try {
      const result = await areaApi.mergeAreas({
        params: { projectId: project.id },
        body: { sourceIds: props.sources.map((s) => s.id), targetId },
      });
      toaster.success(
        String(
          result.movedQuests === 1
            ? tr("project.settings.areas.merge.done.one")
            : tr("project.settings.areas.merge.done", {
                args: [String(result.movedQuests)],
              }),
        ),
      );
      setTargetId(undefined);
      props.onMerged();
      props.onClose();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("project.settings.areas.merge.title")}</DialogTitle>
        </DialogHeader>
        <Control
          input={form.input.targetId}
          label={String(tr("project.settings.areas.merge.target"))}
          triggerClassName="w-full"
          items={props.candidates.map((c) => ({
            value: String(c.id),
            label: c.name,
          }))}
        />
        {target && (
          <DialogDescription>
            {String(
              props.sources.length === 1
                ? tr("project.settings.areas.merge.confirm.one", {
                    args: [String(movingQuests), target.name],
                  })
                : tr("project.settings.areas.merge.confirm", {
                    args: [
                      String(movingQuests),
                      target.name,
                      String(props.sources.length),
                    ],
                  }),
            )}
          </DialogDescription>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            {tr("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !targetId}
          >
            {tr("project.settings.areas.merge.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AreaMergeDialog;
