import { DataTable } from "@alepha/ui/table";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import type { OtaDeviceResource } from "../../ota-api/schemas/otaDeviceResourceSchema.ts";

export interface OtaDevicesTabProps {
  app: OtaAppResource;
}

/**
 * Devices seen in the last seven days, as they reported themselves: what
 * they ran when they last checked in, never a promise that they are online.
 */
export const OtaDevicesTab = (props: OtaDevicesTabProps) => {
  const client = useClient<OtaAdminController>();
  const { tr } = useI18n();
  const devices = useQuery(
    {
      key: ["ota-devices", props.app.id],
      handler: () => client.otaListDevices({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 py-4">
      <p className="text-muted-foreground text-sm">
        {tr("ota.admin.devices.hint", {
          default:
            "Seen in the last 7 days. Telemetry the devices sent, not a live presence.",
        })}
      </p>
      <DataTable<OtaDeviceResource>
        className="min-h-0 flex-1"
        persistenceKey="ota.devices"
        data={devices.data ?? []}
        columns={{
          deviceId: {
            label: tr("ota.admin.devices.device", { default: "Device" }),
            cell: (device) => (
              <code className="text-xs">{device.deviceId.slice(0, 13)}</code>
            ),
          },
          platform: {
            label: tr("ota.admin.cohort.platform", { default: "Platform" }),
            cell: (device) =>
              `${device.platform}${device.isEmulator ? " (emulator)" : ""}`,
          },
          versionCode: {
            label: tr("ota.admin.devices.build", { default: "Native build" }),
            cell: (device) =>
              `${device.versionBuild ?? ""} (${device.versionCode})`,
          },
          versionName: {
            label: tr("ota.admin.devices.running", { default: "Running" }),
            cell: (device) => device.versionName,
          },
          channel: {
            label: tr("ota.admin.devices.channel", { default: "Channel" }),
            cell: (device) => device.channel ?? "-",
          },
          failedVersions: {
            label: tr("ota.admin.devices.failed", {
              default: "Rolled back from",
            }),
            cell: (device) => device.failedVersions.join(", ") || "-",
          },
          lastSeenAt: {
            label: tr("ota.admin.devices.seen", { default: "Last seen" }),
            cell: (device) => new Date(device.lastSeenAt).toLocaleString(),
          },
        }}
      />
    </div>
  );
};
