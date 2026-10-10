import { useDialog } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Rocket, ShieldOff, Upload } from "lucide-react";
import { useState } from "react";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import type { OtaBundleResource } from "../../ota-api/schemas/otaBundleResourceSchema.ts";
import { OtaBundleStatusBadge } from "./OtaBundleStatusBadge.tsx";
import { OtaPromoteDialog } from "./OtaPromoteDialog.tsx";
import { OtaUploadDialog } from "./OtaUploadDialog.tsx";

export interface OtaBundlesTabProps {
  app: OtaAppResource;
}

/**
 * Every bundle published for the app: the exact native builds it runs on,
 * the publisher key it was sealed with, its three digests, and its state.
 */
export const OtaBundlesTab = (props: OtaBundlesTabProps) => {
  const client = useClient<OtaAdminController>();
  const dialog = useDialog();
  const { tr } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [promoting, setPromoting] = useState<OtaBundleResource | undefined>();
  const bundles = useQuery(
    {
      key: ["ota-bundles", props.app.id],
      handler: () => client.otaListBundles({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );

  const kill = useAction<[bundle: OtaBundleResource], boolean>(
    {
      handler: async (bundle) => {
        const confirmed = await dialog.confirm({
          title: tr("ota.admin.bundles.killTitle", {
            default: "Kill this bundle?",
          }),
          description: tr("ota.admin.bundles.killConfirm", {
            default:
              "$1 of $2 will never be served again, pins included. Devices holding it drop it, and devices running it fall back (or reset to their built-in web layer) at their next check. A device that stays offline keeps running it. The artifact is kept.",
            args: [bundle.version, props.app.appId],
          }),
          confirmLabel: tr("ota.admin.kill", { default: "Kill" }),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await client.otaKillBundle({ params: { id: bundle.id }, body: {} });
        return true;
      },
      invalidates: [
        ["ota-bundles", props.app.id],
        ["ota-channels", props.app.id],
      ],
    },
    [client, dialog, props.app],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col py-4">
      <DataTable<OtaBundleResource>
        className="min-h-0 flex-1"
        persistenceKey="ota.bundles"
        data={bundles.data ?? []}
        actions={[
          {
            icon: Upload,
            label: tr("ota.admin.bundles.upload", {
              default: "Upload a release",
            }),
            primary: true,
            disabled: kill.loading,
            onClick: () => setUploading(true),
          },
        ]}
        rowActions={() => [
          {
            label: tr("ota.admin.bundles.promote", {
              default: "Serve from a channel",
            }),
            icon: Rocket,
            disabled: (bundle) =>
              kill.loading || bundle.status !== "ready" || !!bundle.killedAt,
            onClick: (bundle) => setPromoting(bundle),
          },
          {
            label: tr("ota.admin.bundles.kill", { default: "Kill switch" }),
            icon: ShieldOff,
            destructive: true,
            disabled: (bundle) => kill.loading || !!bundle.killedAt,
            onClick: (bundle) => void kill.run(bundle),
          },
        ]}
        columns={{
          version: {
            label: tr("ota.admin.bundles.version", { default: "Version" }),
            cell: (bundle) => (
              <span className="font-medium">{bundle.version}</span>
            ),
          },
          status: {
            label: tr("ota.admin.bundles.status", { default: "Status" }),
            cell: (bundle) => <OtaBundleStatusBadge bundle={bundle} />,
          },
          platform: {
            label: tr("ota.admin.cohort.platform", { default: "Platform" }),
            cell: (bundle) => `${bundle.platform} · ${bundle.variant}`,
          },
          channel: {
            label: tr("ota.admin.bundles.channel", { default: "Published to" }),
            cell: (bundle) => bundle.channel,
          },
          builds: {
            label: tr("ota.admin.bundles.builds", { default: "Native builds" }),
            cell: (bundle) => bundle.builds.join(", "),
          },
          fingerprint: {
            label: tr("ota.admin.cohort.fingerprint", {
              default: "Native fingerprint",
            }),
            defaultHidden: true,
            cell: (bundle) => (
              <code className="text-xs">{bundle.fingerprint.slice(0, 12)}</code>
            ),
          },
          keyId: {
            label: tr("ota.admin.apps.colKey", { default: "Publisher key" }),
            defaultHidden: true,
            cell: (bundle) => <code className="text-xs">{bundle.keyId}</code>,
          },
          archiveSha256: {
            label: tr("ota.admin.bundles.archiveDigest", {
              default: "Archive SHA-256",
            }),
            defaultHidden: true,
            cell: (bundle) => (
              <code className="text-xs">
                {bundle.archiveSha256.slice(0, 16)}
              </code>
            ),
          },
          ciphertextSha256: {
            label: tr("ota.admin.bundles.ciphertextDigest", {
              default: "Ciphertext SHA-256",
            }),
            defaultHidden: true,
            cell: (bundle) => (
              <code className="text-xs">
                {bundle.ciphertextSha256.slice(0, 16)}
              </code>
            ),
          },
          size: {
            label: tr("ota.admin.bundles.size", { default: "Size" }),
            align: "right",
            cell: (bundle) => `${(bundle.size / 1024).toFixed(0)} KiB`,
          },
          createdAt: {
            label: tr("ota.admin.bundles.created", { default: "Published" }),
            cell: (bundle) => new Date(bundle.createdAt).toLocaleString(),
          },
        }}
      />
      <OtaUploadDialog
        app={props.app}
        open={uploading}
        onOpenChange={setUploading}
      />
      {promoting ? (
        <OtaPromoteDialog
          app={props.app}
          bundle={promoting}
          onClose={() => setPromoting(undefined)}
        />
      ) : null}
    </div>
  );
};
