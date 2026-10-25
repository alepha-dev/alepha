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
import { useClient, useQuery, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import type { OtaBundleResource } from "../../ota-api/schemas/otaBundleResourceSchema.ts";
import { otaPromoteFormSchema } from "../schemas/otaPromoteFormSchema.ts";

export interface OtaPromoteDialogProps {
  app: OtaAppResource;
  bundle: OtaBundleResource;
  onClose: () => void;
}

/**
 * Serve a bundle from a channel, to a share of its cohort. What the cohort
 * served until now becomes its fallback.
 */
export const OtaPromoteDialog = (props: OtaPromoteDialogProps) => {
  const client = useClient<OtaAdminController>();
  const queries = useQueryClient();
  const { tr } = useI18n();
  const channels = useQuery(
    {
      key: ["ota-channels", props.app.id],
      handler: () => client.otaListChannels({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );
  const form = useForm(
    {
      schema: otaPromoteFormSchema,
      initialValues: { channelId: "", rollout: 10 },
      handler: async (values) => {
        await client.otaPromote({
          params: { id: values.channelId },
          body: { bundleId: props.bundle.id, rollout: values.rollout },
        });
        queries.invalidate(["ota-channels", props.app.id]);
        props.onClose();
      },
    },
    [client, props.bundle.id],
  );
  const state = useFormState(form);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("ota.admin.bundles.promoteTitle", {
              default: "Serve $1",
              args: [props.bundle.version],
            })}
          </DialogTitle>
          <DialogDescription>
            {tr("ota.admin.bundles.promoteHint", {
              default:
                "Rollout starts small (10 percent by default): a stable share of the channel's devices gets it at their next check.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} id="ota-promote" className="flex flex-col gap-4">
          <Control
            input={form.input.channelId}
            select
            items={(channels.data ?? []).map((it) => ({
              value: it.id,
              label: it.name,
            }))}
            label={tr("ota.admin.bundles.channel", { default: "Published to" })}
          />
          <Control
            input={form.input.rollout}
            number
            label={tr("ota.admin.cohort.share", { default: "Rollout" })}
          />
        </form>
        <DialogFooter>
          <Button type="button" variant="minimal" onClick={props.onClose}>
            {tr("ota.admin.cancel", { default: "Cancel" })}
          </Button>
          <Button type="submit" form="ota-promote" loading={state.loading}>
            {tr("ota.admin.save", { default: "Save" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
