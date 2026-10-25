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
import { otaOverrideFormSchema } from "../schemas/otaOverrideFormSchema.ts";

export interface OtaOverrideDialogProps {
  app: OtaAppResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Put one device on a channel, or pin it to a bundle. The device id is the
 * one the Devices tab shows.
 */
export const OtaOverrideDialog = (props: OtaOverrideDialogProps) => {
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
  const bundles = useQuery(
    {
      key: ["ota-bundles", props.app.id],
      handler: () => client.otaListBundles({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );
  const form = useForm(
    {
      schema: otaOverrideFormSchema,
      initialValues: { deviceId: "" },
      handler: async (values) => {
        await client.otaSetOverride({
          body: {
            appRef: props.app.id,
            deviceId: values.deviceId,
            channel: values.channel || undefined,
            bundleId: values.bundleId || undefined,
            note: values.note || undefined,
          },
        });
        queries.invalidate(["ota-overrides", props.app.id]);
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
            {tr("ota.admin.overrides.create", { default: "Assign a device" })}
          </DialogTitle>
          <DialogDescription>
            {tr("ota.admin.overrides.hint", {
              default:
                "A channel, a pinned bundle, or both. The pin wins while its bundle is servable.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} id="ota-override" className="flex flex-col gap-4">
          <Control
            input={form.input.deviceId}
            label={tr("ota.admin.devices.device", { default: "Device" })}
          />
          <Control
            input={form.input.channel}
            select
            clearable
            items={(channels.data ?? []).map((it) => ({
              value: it.name,
              label: it.name,
            }))}
            label={tr("ota.admin.devices.channel", { default: "Channel" })}
          />
          <Control
            input={form.input.bundleId}
            select
            clearable
            items={(bundles.data ?? [])
              .filter((it) => it.status === "ready" && !it.killedAt)
              .map((it) => ({
                value: it.id,
                label: it.version,
                description: `${it.platform} · ${it.channel}`,
              }))}
            label={tr("ota.admin.overrides.pinned", {
              default: "Pinned bundle",
            })}
          />
          <Control
            input={form.input.note}
            label={tr("ota.admin.overrides.note", { default: "Note" })}
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
          <Button type="submit" form="ota-override" loading={state.loading}>
            {tr("ota.admin.save", { default: "Save" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
