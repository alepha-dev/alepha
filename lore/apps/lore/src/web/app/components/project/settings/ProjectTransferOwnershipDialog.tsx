import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { RankResource } from "alepha/api/ranks";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectTransferOwnershipDialogProps {
  projectId: number;

  /**
   * The member being promoted. `undefined` closes the dialog, which is what
   * makes the parent's state one variable instead of two.
   */
  target?: { userId: string; name: string };

  ranks: RankResource[];

  onOpenChange: (open: boolean) => void;

  onTransferred: () => void | Promise<void>;
}

/**
 * Handing the project to somebody else.
 *
 * Two steps on purpose, and the split is the point.
 *
 * The dialog asks the one question a confirmation cannot: **what the outgoing
 * owner becomes**. There is no sensible default beyond `member`, and picking
 * it afterwards is not an option - the transfer is one statement, and the
 * person who performed it cannot undo it.
 *
 * Then `useDialog().confirm({ destructive: true })` spells out the whole
 * consequence in one sentence: you become X, they become the owner, and only
 * they can give it back. Never `window.confirm`, which cannot be styled,
 * cannot be destructive and cannot be read by a test.
 */
const ProjectTransferOwnershipDialog = (
  props: ProjectTransferOwnershipDialogProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const api = useClient<ProjectController>();
  const [keep, setKeep] = useState("member");
  const [busy, setBusy] = useState(false);

  const assignable = props.ranks.filter((it) => it.key !== "owner");
  const keptName = assignable.find((it) => it.key === keep)?.name ?? "member";
  const target = props.target;

  const transfer = async () => {
    if (!target) return;

    const ok = await dialog.confirm({
      title: String(
        tr("project.settings.members.transfer.confirmTitle", {
          args: [target.name],
        }),
      ),
      description: String(
        tr("project.settings.members.transfer.confirmDescription", {
          args: [target.name, keptName],
        }),
      ),
      confirmLabel: String(tr("project.settings.members.transfer.confirm")),
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.transferOwnership({
        params: { id: props.projectId },
        body: { userId: target.userId, rank: keep },
      });
      props.onOpenChange(false);
      await props.onTransferred();
      toaster.success(
        tr("project.settings.members.transfer.done", { args: [target.name] }),
      );
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("project.settings.members.transfer.title", {
              args: [target?.name ?? ""],
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            {tr("project.settings.members.transfer.description")}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>{tr("project.settings.members.transfer.keep")}</Label>
            <Select
              value={keep}
              disabled={busy}
              onValueChange={(value) => setKeep(String(value))}
            >
              <SelectTrigger
                data-testid="transfer-keep"
                aria-label={String(
                  tr("project.settings.members.transfer.keep"),
                )}
              >
                {/* The resolved NAME. Base UI renders the raw value, and a
                    rank's value is its opaque key. */}
                <SelectValue>{keptName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignable.map((rank) => (
                  <SelectItem key={rank.key} value={rank.key}>
                    {rank.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => props.onOpenChange(false)}
          >
            {tr("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            data-testid="transfer-submit"
            onClick={() => void transfer()}
          >
            {tr("project.settings.members.transfer.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectTransferOwnershipDialog;
