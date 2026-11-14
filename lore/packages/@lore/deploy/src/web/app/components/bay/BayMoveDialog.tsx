import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { HostController } from "../../../../api/controllers/HostController.ts";
import type { ProjectHostController } from "../../../../api/controllers/ProjectHostController.ts";
import type { HostResource } from "../../../../api/schemas/hostResourceSchema.ts";
import type { HostLoan } from "../../../../api/schemas/ownedHostResourceSchema.ts";
import { hostMoveFormSchema } from "../shared/hostMoveFormSchema.ts";

export interface BayMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: HostResource;
  loans: HostLoan[];
  /**
   * Called with the moved host once the server accepted.
   */
  onMoved: (host: HostResource) => void;
}

/**
 * Move a host to another project (#Q3280, #Q3281): a project picker
 * listing the projects the caller may create a host in, the loans that
 * stay, and a slug the target already holds refused before submit. The
 * server is the authority on every one of those: this only says it first.
 */
const BayMoveDialog = (props: BayMoveDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const hosts = useClient<HostController>();
  const lending = useClient<ProjectHostController>();

  const choices = (
    useQuery(
      {
        enabled: props.open,
        handler: () => hosts.listHostHomeChoices(),
      },
      [hosts, props.open],
    ).data?.items ?? []
  ).filter((project) => project.id !== props.host.project?.id);

  const form = useForm({
    schema: hostMoveFormSchema,
    initialValues: { projectId: "" },
    handler: () => undefined,
  });
  const values = useFormValues(form);
  const targetId = Number(values.projectId) || undefined;

  // The hosts the target is already the home of, to refuse a slug before
  // the click rather than after it.
  const taken = useQuery(
    {
      enabled: props.open && targetId !== undefined,
      handler: () =>
        targetId === undefined
          ? Promise.resolve({ items: [] })
          : lending.listHomeHosts({ params: { projectId: targetId } }),
      onError: () => {},
    },
    [lending, props.open, targetId],
  ).data?.items;
  const collides = (taken ?? []).some((host) => host.slug === props.host.slug);

  const move = useAction<[], void>(
    {
      handler: async () => {
        if (targetId === undefined || collides) return;
        const result = await hosts.moveHost({
          params: { hostId: props.host.id },
          body: { projectId: targetId },
        });
        toaster.success(
          tr("bay.move.toast", { args: [result.host.project?.title ?? ""] }),
        );
        if (result.serverElsewhere) {
          toaster.warning(tr("bay.move.serverElsewhere"));
        }
        props.onMoved(result.host);
        props.onOpenChange(false);
      },
    },
    [hosts, targetId, collides, props.host.id],
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (move.loading) return;
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="bay-move-dialog">
        <DialogHeader>
          <DialogTitle>
            {tr("bay.move.title", { args: [props.host.slug] })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {choices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("bay.move.none")}
            </p>
          ) : (
            <Control
              select
              input={form.input.projectId}
              label={tr("bay.move.project")}
              disabled={move.loading}
              items={choices.map((project) => ({
                value: String(project.id),
                label: project.title,
              }))}
              inputProps={{ "data-testid": "bay-move-project" }}
            />
          )}
          {collides && (
            <p
              className="text-destructive text-sm"
              data-testid="bay-move-taken"
            >
              {tr("bay.move.taken", { args: [props.host.slug] })}
            </p>
          )}
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <span>{tr("bay.move.keeps")}</span>
            {props.loans.length > 0 && (
              <span data-testid="bay-move-loans">
                {tr("bay.move.loans", {
                  args: [props.loans.map((loan) => loan.title).join(", ")],
                })}
              </span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="solid"
            intent="none"
            disabled={move.loading}
            onClick={() => props.onOpenChange(false)}
          >
            {tr("account.hosts.create.cancel")}
          </Button>
          <Button
            type="button"
            disabled={targetId === undefined || collides || move.loading}
            onClick={() => void move.run()}
            data-testid="bay-move-submit"
          >
            {tr("bay.move.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BayMoveDialog;
