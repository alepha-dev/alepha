import { Button, Card, CardContent, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import { otaSettingsFormSchema } from "../schemas/otaSettingsFormSchema.ts";

export interface OtaSettingsTabProps {
  app: OtaAppResource;
}

/**
 * The app's name, default channel, publisher public key, and the API keys
 * allowed to publish to it (on top of their `ota:release` permission).
 */
export const OtaSettingsTab = (props: OtaSettingsTabProps) => {
  const client = useClient<OtaAdminController>();
  const queries = useQueryClient();
  const dialog = useDialog();
  const router = useRouter();
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
      schema: otaSettingsFormSchema,
      initialValues: {
        name: props.app.name,
        defaultChannel: props.app.defaultChannel,
        publisherKeyIds: props.app.publisherKeyIds,
        publicKey: props.app.publicKey,
      },
      handler: async (values) => {
        await client.otaUpdateApp({
          params: { id: props.app.id },
          body: values,
        });
        queries.invalidate(["ota-app", props.app.id]);
        queries.invalidate(["ota-apps"]);
      },
    },
    [client, props.app.id],
  );
  const state = useFormState(form);

  const remove = useAction(
    {
      handler: async () => {
        const confirmed = await dialog.confirm({
          title: tr("ota.admin.settings.deleteTitle", {
            default: "Delete this app?",
          }),
          description: tr("ota.admin.settings.deleteConfirm", {
            default:
              "$1 stops receiving live updates: its channels, bundles and device records go, and installed apps keep the web layer they run.",
            args: [props.app.appId],
          }),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await client.otaDeleteApp({ params: { id: props.app.id } });
        await router.push("otaApps");
        return true;
      },
      invalidates: [["ota-apps"]],
    },
    [client, dialog, router, props.app],
  );

  return (
    <div className="flex flex-col gap-4 py-4">
      <Card>
        <CardContent>
          <form {...form.props} className="flex flex-col gap-4">
            <Control
              input={form.input.name}
              label={tr("ota.admin.apps.colName", { default: "Name" })}
            />
            <Control
              input={form.input.defaultChannel}
              select
              items={(channels.data ?? []).map((it) => ({
                value: it.name,
                label: it.name,
              }))}
              label={tr("ota.admin.apps.colChannel", {
                default: "Default channel",
              })}
            />
            <Control
              input={form.input.publisherKeyIds}
              createNewEntry
              label={tr("ota.admin.settings.keys", {
                default: "API keys allowed to publish (ids)",
              })}
            />
            <Control
              input={form.input.publicKey}
              area
              label={tr("ota.admin.apps.publicKey", { default: "Public key" })}
              description={tr("ota.admin.settings.keyHint", {
                default:
                  "Changing it is a key rotation: bundles sealed with the old key are refused, and binaries carrying the old key cannot run new bundles.",
              })}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                loading={state.loading}
                disabled={remove.loading}
              >
                {tr("ota.admin.save", { default: "Save" })}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          intent="danger"
          disabled={state.loading || remove.loading}
          onClick={() => void remove.run()}
        >
          {tr("ota.admin.settings.delete", { default: "Delete app" })}
        </Button>
      </div>
    </div>
  );
};
