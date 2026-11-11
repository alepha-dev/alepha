import * as React from "react";

void React;

import { z } from "alepha";
import type {
  AdminWebhookController,
  WebhookDeliveryResource,
} from "alepha/api/webhooks";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleDot, Tag } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "../core/Badge.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { DataTable } from "../table/DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
} from "../table/dataTableTypes.ts";
import { AdminWebhookDeliveryDialog } from "./AdminWebhookDeliveryDialog.tsx";

/**
 * The delivery statuses the filter offers.
 */
const DELIVERY_STATUSES = [
  "pending",
  "delivered",
  "failed",
] as const satisfies readonly WebhookDeliveryResource["status"][];

export interface AdminWebhookDeliveriesProps {
  endpointId: string;
  endpointActive: boolean;
  events: string[];
}

/**
 * An endpoint's delivery log, newest first. A row opens the delivery.
 */
export const AdminWebhookDeliveries = (props: AdminWebhookDeliveriesProps) => {
  const api = useClient<AdminWebhookController>();
  const { tr } = useI18n();
  const [open, setOpen] = useState<string | undefined>();
  const [refreshSignal, setRefreshSignal] = useState(0);

  const statusLabel = (status: WebhookDeliveryResource["status"]) =>
    status === "pending"
      ? tr("admin.webhooks.delivery.pending", { default: "Pending" })
      : status === "delivered"
        ? tr("admin.webhooks.delivery.delivered", { default: "Delivered" })
        : tr("admin.webhooks.delivery.failed", { default: "Failed" });

  const filterFields = {
    status: {
      schema: z.enum(DELIVERY_STATUSES),
      label: tr("admin.webhooks.colStatus", { default: "Status" }),
      icon: CircleDot,
      optionLabel: statusLabel,
      control: {
        clearLabel: tr("admin.webhooks.allStatuses", {
          default: "All statuses",
        }),
      },
    },
    eventType: {
      schema: z.text(),
      label: tr("admin.webhooks.colEvent", { default: "Event" }),
      icon: Tag,
      hidden: props.events.length === 0,
      items: props.events.map((name) => ({ label: name, value: name })),
      control: {
        clearLabel: tr("admin.webhooks.allEvents", { default: "All events" }),
      },
    },
  } satisfies DataTableFilterFields;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      const f = params.filters ?? {};
      return api.findWebhookDeliveries({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          endpointId: props.endpointId,
          ...(f.status ? { status: f.status } : {}),
          ...(f.eventType ? { eventType: f.eventType } : {}),
        },
      });
    },
    [api, props.endpointId],
  );

  return (
    <>
      <DataTable<WebhookDeliveryResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="admin.webhooks.deliveries"
        fetch={fetcher}
        refreshSignal={refreshSignal}
        filters={{ fields: filterFields }}
        onRowClick={(delivery) => setOpen(delivery.id)}
        columns={{
          eventType: {
            label: tr("admin.webhooks.colEvent", { default: "Event" }),
            cell: (d) => <Badge variant="secondary">{d.eventType}</Badge>,
          },
          status: {
            label: tr("admin.webhooks.colStatus", { default: "Status" }),
            cell: (d) => (
              <Badge
                variant="tint"
                tone={
                  d.status === "delivered"
                    ? "success"
                    : d.status === "failed"
                      ? "danger"
                      : "neutral"
                }
              >
                {statusLabel(d.status)}
              </Badge>
            ),
          },
          responseStatus: {
            label: tr("admin.webhooks.colHttpStatus", {
              default: "HTTP status",
            }),
            cell: (d) => (
              <span className="font-mono text-xs">
                {d.responseStatus ?? ""}
              </span>
            ),
          },
          attempt: {
            label: tr("admin.webhooks.colAttempts", { default: "Attempts" }),
            cell: (d) => <span className="text-xs">{d.attempt}</span>,
          },
          durationMs: {
            label: tr("admin.webhooks.colDuration", { default: "Duration" }),
            cell: (d) =>
              d.durationMs !== undefined ? (
                <span className="text-xs">{d.durationMs} ms</span>
              ) : null,
          },
          createdAt: {
            label: tr("admin.webhooks.colTime", { default: "Time" }),
            sortable: true,
            cell: (d) => (
              <TimeAgo
                value={d.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
        }}
      />
      <AdminWebhookDeliveryDialog
        deliveryId={open}
        endpointActive={props.endpointActive}
        onClose={() => setOpen(undefined)}
        onRedelivered={() => setRefreshSignal((n) => n + 1)}
      />
    </>
  );
};
