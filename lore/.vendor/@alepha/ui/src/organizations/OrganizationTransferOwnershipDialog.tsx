import { z } from "alepha";
import type {
  MemberController,
  OrganizationRankResource,
} from "alepha/api/organizations";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { Control } from "../form/Control.tsx";

const transferRankFieldSchema = z.object({ rank: z.text() });

export interface OrganizationTransferOwnershipDialogProps {
  organizationId: string;
  target?: { userId: string; name: string };
  ranks: OrganizationRankResource[];
  onOpenChange: (open: boolean) => void;
  onTransferred: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

export const OrganizationTransferOwnershipDialog = (
  props: OrganizationTransferOwnershipDialogProps,
) => {
  const api = useClient<MemberController>();
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();
  const form = useForm({
    schema: transferRankFieldSchema,
    initialValues: { rank: "member" },
    handler: () => {},
  });
  const rank = String(useFormValues(form).rank ?? "member");
  const assignable = props.ranks.filter((item) => item.key !== "owner");
  const rankName = assignable.find((item) => item.key === rank)?.name ?? rank;

  const transfer = useAction<[], void>(
    {
      handler: async () => {
        if (!props.target) return;
        const confirmed = await dialog.confirm({
          title: tr("organizations.transfer.confirmTitle", {
            default: "Transfer ownership to $1?",
            args: [props.target.name],
          }),
          description: tr("organizations.transfer.confirmDescription", {
            default:
              "$1 becomes the owner. You become $2, and only the new owner can transfer ownership again.",
            args: [props.target.name, rankName],
          }),
          confirmLabel: tr("organizations.transfer.confirm", {
            default: "Transfer",
          }),
          destructive: true,
        });
        if (!confirmed) return;
        props.onBusyChange?.(true);
        try {
          await api.transferOrganizationOwnership({
            params: { organizationId: props.organizationId },
            body: { userId: props.target.userId, rank },
          });
          props.onOpenChange(false);
          await props.onTransferred();
          toaster.success(
            tr("organizations.transfer.done", {
              default: "Ownership transferred to $1",
              args: [props.target.name],
            }),
          );
        } finally {
          props.onBusyChange?.(false);
        }
      },
    },
    [api, dialog, props, rank, rankName, toaster, tr],
  );

  return (
    <Dialog open={!!props.target} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("organizations.transfer.title", {
              default: "Transfer ownership",
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            {tr("organizations.transfer.description", {
              default: "Choose the rank you will hold after the transfer.",
            })}
          </p>
          <Control
            select
            input={form.input.rank}
            label={tr("organizations.transfer.yourRank", {
              default: "Your new rank",
            })}
            disabled={transfer.loading}
            items={assignable.map((item) => ({
              value: item.key,
              label: item.name,
            }))}
            inputProps={{ "data-testid": "transfer-keep" }}
            placeholder={rankName}
          />
        </div>
        <DialogFooter>
          <Button
            variant="minimal"
            disabled={transfer.loading}
            onClick={() => props.onOpenChange(false)}
          >
            {tr("organizations.members.cancel", { default: "Cancel" })}
          </Button>
          <Button
            intent="danger"
            data-testid="transfer-submit"
            disabled={transfer.loading}
            onClick={() => void transfer.run()}
          >
            {tr("organizations.transfer.action", {
              default: "Transfer ownership",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
