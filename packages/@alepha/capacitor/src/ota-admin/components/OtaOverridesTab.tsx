import { useDialog } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import type { OtaOverrideResource } from "../../ota-api/schemas/otaOverrideResourceSchema.ts";
import { OtaOverrideDialog } from "./OtaOverrideDialog.tsx";

export interface OtaOverridesTabProps {
  app: OtaAppResource;
}

/**
 * Private QA assignments: one device on a channel, or pinned to a bundle.
 * Only an operator makes them; a device never can. A killed bundle is not
 * served, pinned or not.
 */
export const OtaOverridesTab = (props: OtaOverridesTabProps) => {
  const client = useClient<OtaAdminController>();
  const dialog = useDialog();
  const { tr } = useI18n();
  const [creating, setCreating] = useState(false);
  const overrides = useQuery(
    {
      key: ["ota-overrides", props.app.id],
      handler: () => client.otaListOverrides({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );

  const remove = useAction<[override: OtaOverrideResource], boolean>(
    {
      handler: async (override) => {
        const confirmed = await dialog.confirm({
          title: tr("ota.admin.overrides.removeTitle", {
            default: "Remove this override?",
          }),
          description: tr("ota.admin.overrides.removeConfirm", {
            default:
              "Device $1 goes back to its own channel at its next check.",
            args: [override.deviceId],
          }),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await client.otaDeleteOverride({ params: { id: override.id } });
        return true;
      },
      invalidates: [["ota-overrides", props.app.id]],
    },
    [client, dialog, props.app.id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col py-4">
      <DataTable<OtaOverrideResource>
        className="min-h-0 flex-1"
        persistenceKey="ota.overrides"
        data={overrides.data ?? []}
        actions={[
          {
            icon: Plus,
            label: tr("ota.admin.overrides.create", {
              default: "Assign a device",
            }),
            primary: true,
            disabled: remove.loading,
            onClick: () => setCreating(true),
          },
        ]}
        rowActions={() => [
          {
            label: tr("ota.admin.overrides.remove", { default: "Remove" }),
            icon: Trash2,
            destructive: true,
            disabled: () => remove.loading,
            onClick: (override) => void remove.run(override),
          },
        ]}
        columns={{
          deviceId: {
            label: tr("ota.admin.devices.device", { default: "Device" }),
            cell: (override) => (
              <code className="text-xs">{override.deviceId}</code>
            ),
          },
          channel: {
            label: tr("ota.admin.devices.channel", { default: "Channel" }),
            cell: (override) => override.channel ?? "-",
          },
          bundleId: {
            label: tr("ota.admin.overrides.pinned", {
              default: "Pinned bundle",
            }),
            cell: (override) =>
              override.bundleId ? (
                <code className="text-xs">{override.bundleId.slice(0, 8)}</code>
              ) : (
                "-"
              ),
          },
          note: {
            label: tr("ota.admin.overrides.note", { default: "Note" }),
            cell: (override) => override.note ?? "",
          },
        }}
      />
      <OtaOverrideDialog
        app={props.app}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  );
};
