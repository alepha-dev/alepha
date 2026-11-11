import * as React from "react";

void React;

import type { AdminWebhookController } from "alepha/api/webhooks";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { History, Settings2 } from "lucide-react";

import { DetailLayout } from "../shell/DetailLayout.tsx";
import { useDetailTab } from "../shell/useDetailTab.tsx";
import { AdminWebhookDeliveries } from "./AdminWebhookDeliveries.tsx";
import { AdminWebhookDetailAside } from "./AdminWebhookDetailAside.tsx";
import { AdminWebhookDetailOverview } from "./AdminWebhookDetailOverview.tsx";

/**
 * One webhook endpoint: its settings, and its delivery log.
 */
export const AdminWebhookDetail = () => {
  const router = useRouter<any>();
  const routerState = useRouterState();
  const endpointId = String(
    (routerState.params as { endpointId?: string }).endpointId ?? "",
  );
  const api = useClient<AdminWebhookController>();
  const { tr } = useI18n();
  const [tab, setTab] = useDetailTab<"overview" | "deliveries">("overview");

  const endpoint = useQuery(
    {
      key: ["webhook-endpoint", endpointId],
      enabled: endpointId !== "",
      handler: () => api.getWebhookEndpoint({ params: { id: endpointId } }),
    },
    [api, endpointId],
  );
  const catalog = useQuery(
    { key: ["webhook-events"], handler: () => api.getWebhookEvents() },
    [api],
  );
  const data = endpoint.data?.id === endpointId ? endpoint.data : undefined;

  return (
    <DetailLayout
      loading={endpoint.loading && !data}
      notFound={
        data || endpoint.loading
          ? undefined
          : {
              message: tr("admin.webhooks.notFound", {
                default: "Endpoint not found.",
              }),
              backLabel: tr("admin.webhooks.back", {
                default: "Back to endpoints",
              }),
              onBack: () => void router.push("/admin/webhooks"),
            }
      }
      aside={data ? <AdminWebhookDetailAside endpoint={data} /> : null}
      tabs={[
        {
          value: "overview",
          icon: Settings2,
          label: tr("admin.webhooks.tabOverview", { default: "Overview" }),
        },
        {
          value: "deliveries",
          icon: History,
          label: tr("admin.webhooks.tabDeliveries", { default: "Deliveries" }),
        },
      ]}
      tab={tab}
      onTabChange={(value) => setTab(value as "overview" | "deliveries")}
    >
      {data && tab === "overview" ? (
        <AdminWebhookDetailOverview
          endpoint={data}
          events={(catalog.data ?? []).map((it) => it.name)}
          onSaved={() => void endpoint.refetch()}
        />
      ) : null}
      {data && tab === "deliveries" ? (
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <AdminWebhookDeliveries
            endpointId={data.id}
            endpointActive={data.status === "active"}
            events={(catalog.data ?? []).map((it) => it.name)}
          />
        </div>
      ) : null}
    </DetailLayout>
  );
};

export default AdminWebhookDetail;
