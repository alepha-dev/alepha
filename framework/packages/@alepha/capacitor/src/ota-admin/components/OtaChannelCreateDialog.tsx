import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import { otaChannelFormSchema } from "../schemas/otaChannelFormSchema.ts";

export interface OtaChannelCreateDialogProps {
  app: OtaAppResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A new channel, private unless devices may pick it themselves.
 */
export const OtaChannelCreateDialog = (props: OtaChannelCreateDialogProps) => {
  const client = useClient<OtaAdminController>();
  const queries = useQueryClient();
  const { tr } = useI18n();
  const form = useForm(
    {
      schema: otaChannelFormSchema,
      initialValues: { name: "", allowSelfAssign: false },
      handler: async (values) => {
        await client.otaCreateChannel({
          body: { appRef: props.app.id, ...values },
        });
        queries.invalidate(["ota-channels", props.app.id]);
        props.onOpenChange(false);
      },
    },
    [client, props.app.id],
  );
  const state = useFormState(form);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("ota.admin.channels.create", { default: "New channel" })}
          </DialogTitle>
          <DialogDescription>
            {tr("ota.admin.channels.createHint", {
              default:
                "A private channel is reached through a device override. A self-assignable one, by any device that asks.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          id="ota-channel-create"
          className="flex flex-col gap-4"
        >
          <Control
            input={form.input.name}
            label={tr("ota.admin.channels.name", { default: "Name" })}
          />
          <Control
            input={form.input.allowSelfAssign}
            switch
            label={tr("ota.admin.channels.selfAssign", {
              default: "Devices may assign themselves",
            })}
          />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="minimal"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("ota.admin.cancel", { default: "Cancel" })}
          </Button>
          <Button
            type="submit"
            form="ota-channel-create"
            loading={state.loading}
          >
            {tr("ota.admin.create", { default: "Create" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
