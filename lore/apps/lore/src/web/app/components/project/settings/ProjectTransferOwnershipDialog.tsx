import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import type { RankResource } from "alepha/api/ranks";
import { useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * What the outgoing owner becomes. Required, so the field cannot be cleared
 * back to nothing: the transfer needs a rank to put them in, and `member` is
 * the only sensible starting point.
 */
const keepFieldSchema = z.object({ keep: z.text() });

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
  const [busy, setBusy] = useState(false);

  // A one-field form rather than `useState`, so this is a `Control` like
  // every other picker in the app (feedback #P2121). Nothing saves on change
  // here: the value is read by `transfer` when the reader presses the button.
  const form = useForm({
    schema: keepFieldSchema,
    initialValues: { keep: "member" },
    handler: () => {},
  });
  const keep = String(useFormValues(form).keep ?? "member");

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
          <Control
            select
            input={form.input.keep}
            label={String(tr("project.settings.members.transfer.keep"))}
            disabled={busy}
            // The resolved NAME comes for free: `Control` looks the label up
            // in `items`, where the raw select rendered the value - a rank's
            // opaque key - and needed `<SelectValue>{keptName}</SelectValue>`
            // to say otherwise.
            items={assignable.map((rank) => ({
              value: rank.key,
              label: rank.name,
            }))}
            inputProps={{
              "data-testid": "transfer-keep",
              "aria-label": String(
                tr("project.settings.members.transfer.keep"),
              ),
            }}
            // For a rank list that has not loaded: with no matching item the
            // trigger would be blank.
            placeholder={keptName}
          />
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
