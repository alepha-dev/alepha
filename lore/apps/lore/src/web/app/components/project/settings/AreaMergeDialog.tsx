import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

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
          tr("project.settings.areas.merge.done", {
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="area-merge-target">
            {tr("project.settings.areas.merge.target")}
          </Label>
          <Select
            // `?? null`, never `undefined`: an initial `undefined` mounts
            // the root uncontrolled, so a later programmatic reset (on
            // close) would no longer drive the trigger.
            value={targetId != null ? String(targetId) : null}
            // Base UI resolves the trigger label from `items` rather than
            // from the rendered `SelectItem`s: without it, a
            // programmatically selected value shows the placeholder until
            // the popup has been opened once, because the item list lives
            // in an unmounted popup until then.
            items={props.candidates.map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
            onValueChange={(v) => setTargetId(v ? Number(v) : undefined)}
          >
            <SelectTrigger id="area-merge-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.candidates.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {target && (
          <DialogDescription>
            {String(
              tr("project.settings.areas.merge.confirm", {
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
