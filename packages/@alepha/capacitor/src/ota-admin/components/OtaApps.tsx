import { AdminPage } from "@alepha/ui/admin";
import { DataTable } from "@alepha/ui/table";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import { OtaAppCreateDialog } from "./OtaAppCreateDialog.tsx";

/**
 * The apps that receive live updates: one row per native bundle id, a
 * variant being an app of its own.
 */
export const OtaApps = () => {
  const client = useClient<OtaAdminController>();
  const router = useRouter();
  const { tr } = useI18n();
  const [creating, setCreating] = useState(false);
  const apps = useQuery(
    { key: ["ota-apps"], handler: () => client.otaListApps() },
    [client],
  );

  return (
    <AdminPage>
      <DataTable<OtaAppResource>
        className="min-h-0 flex-1"
        persistenceKey="ota.apps"
        data={apps.data ?? []}
        onRowClick={(app) =>
          void router.push("otaApp", { params: { id: app.id } })
        }
        actions={[
          {
            icon: Plus,
            label: tr("ota.admin.apps.create", { default: "Register an app" }),
            primary: true,
            onClick: () => setCreating(true),
          },
        ]}
        emptyMessage={tr("ota.admin.apps.empty", {
          default: "No app receives live updates yet.",
        })}
        columns={{
          name: {
            label: tr("ota.admin.apps.colName", { default: "Name" }),
            cell: (app) => <span className="font-medium">{app.name}</span>,
          },
          appId: {
            label: tr("ota.admin.apps.colAppId", { default: "Bundle id" }),
            cell: (app) => <code className="text-xs">{app.appId}</code>,
          },
          defaultChannel: {
            label: tr("ota.admin.apps.colChannel", {
              default: "Default channel",
            }),
            cell: (app) => app.defaultChannel,
          },
          keyId: {
            label: tr("ota.admin.apps.colKey", { default: "Publisher key" }),
            cell: (app) => <code className="text-xs">{app.keyId}</code>,
          },
        }}
      />
      <OtaAppCreateDialog open={creating} onOpenChange={setCreating} />
    </AdminPage>
  );
};

export default OtaApps;
