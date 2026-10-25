import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alepha/ui";
import { AdminPage } from "@alepha/ui/admin";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import { OtaBundlesTab } from "./OtaBundlesTab.tsx";
import { OtaChannelsTab } from "./OtaChannelsTab.tsx";
import { OtaDevicesTab } from "./OtaDevicesTab.tsx";
import { OtaOverridesTab } from "./OtaOverridesTab.tsx";
import { OtaSettingsTab } from "./OtaSettingsTab.tsx";

export interface OtaAppDetailProps {
  id: string;
}

/**
 * One app: what its channels serve, its bundles, the devices seen, the
 * operator's device overrides and its settings.
 */
export const OtaAppDetail = (props: OtaAppDetailProps) => {
  const client = useClient<OtaAdminController>();
  const { tr } = useI18n();
  const app = useQuery(
    {
      key: ["ota-app", props.id],
      handler: () => client.otaGetApp({ params: { id: props.id } }),
    },
    [client, props.id],
  );

  if (!app.data) {
    return <AdminPage>{null}</AdminPage>;
  }

  return (
    <AdminPage className="p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{app.data.name}</h1>
        <code className="text-muted-foreground text-xs">{app.data.appId}</code>
      </div>
      <Tabs defaultValue="channels" className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="channels">
            {tr("ota.admin.tab.channels", { default: "Channels" })}
          </TabsTrigger>
          <TabsTrigger value="bundles">
            {tr("ota.admin.tab.bundles", { default: "Bundles" })}
          </TabsTrigger>
          <TabsTrigger value="devices">
            {tr("ota.admin.tab.devices", { default: "Devices" })}
          </TabsTrigger>
          <TabsTrigger value="overrides">
            {tr("ota.admin.tab.overrides", { default: "Device overrides" })}
          </TabsTrigger>
          <TabsTrigger value="settings">
            {tr("ota.admin.tab.settings", { default: "Settings" })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="channels">
          <OtaChannelsTab app={app.data} />
        </TabsContent>
        <TabsContent value="bundles">
          <OtaBundlesTab app={app.data} />
        </TabsContent>
        <TabsContent value="devices">
          <OtaDevicesTab app={app.data} />
        </TabsContent>
        <TabsContent value="overrides">
          <OtaOverridesTab app={app.data} />
        </TabsContent>
        <TabsContent value="settings">
          <OtaSettingsTab app={app.data} />
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
};

export default OtaAppDetail;
