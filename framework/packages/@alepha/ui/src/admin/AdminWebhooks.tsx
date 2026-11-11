import * as React from "react";

void React;

import { z } from "alepha";
import type {
  AdminWebhookController,
  WebhookEndpointResource,
} from "alepha/api/webhooks";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  CircleDot,
  KeyRound,
  Pause,
  Play,
  Plus,
  Power,
  Send,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "../core/Badge.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { useToast } from "../core/useToast.tsx";
import { useUndoable } from "../core/useUndoable.tsx";
import { DataTable } from "../table/DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
  RowActionContext,
} from "../table/dataTableTypes.ts";
import { AdminPage } from "./AdminPage.tsx";
import { AdminWebhookDeliveryDialog } from "./AdminWebhookDeliveryDialog.tsx";
import { AdminWebhooksCreateDialog } from "./AdminWebhooksCreateDialog.tsx";
import { AdminWebhooksSecretDialog } from "./AdminWebhooksSecretDialog.tsx";
import { AdminWebhooksStatusBadge } from "./AdminWebhooksStatusBadge.tsx";
import { AdminWebhooksUrlCell } from "./AdminWebhooksUrlCell.tsx";
import { useConfirmedAction } from "./useConfirmedAction.tsx";

/**
 * The endpoint statuses the filter offers, checked against the resource's
 * type. A local list: a value import from `alepha/api/webhooks` resolves to
 * its browser barrel, but a type is all the filter needs.
 */
const WEBHOOK_STATUSES = [
  "active",
  "paused",
  "disabled",
] as const satisfies readonly WebhookEndpointResource["status"][];

/**
 * The webhook endpoints: who receives the app's events, whether they are
 * healthy, and the operator's levers on them.
 */
export const AdminWebhooks = () => {
  const api = useClient<AdminWebhookController>();
  const router = useRouter<any>();
  const undoable = useUndoable();
  const toast = useToast();
  const { tr } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [testDelivery, setTestDelivery] = useState<string | undefined>();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const refresh = () => setRefreshSignal((n) => n + 1);

  const catalog = useQuery(
    { key: ["webhook-events"], handler: () => api.getWebhookEvents() },
    [api],
  );
  const eventNames = (catalog.data ?? []).map((it) => it.name);

  const statusLabel = (status: WebhookEndpointResource["status"]) =>
    status === "active"
      ? tr("admin.webhooks.status.active", { default: "Active" })
      : status === "paused"
        ? tr("admin.webhooks.status.paused", { default: "Paused" })
        : tr("admin.webhooks.status.disabled", { default: "Disabled" });

  const filterFields = {
    search: { preset: "search" },
    status: {
      schema: z.enum(WEBHOOK_STATUSES),
      label: tr("admin.webhooks.colStatus", { default: "Status" }),
      icon: CircleDot,
      optionLabel: statusLabel,
      control: {
        clearLabel: tr("admin.webhooks.allStatuses", {
          default: "All statuses",
        }),
      },
    },
    event: {
      schema: z.text(),
      label: tr("admin.webhooks.colEvents", { default: "Events" }),
      icon: Tag,
      hidden: eventNames.length === 0,
      items: eventNames.map((name) => ({ label: name, value: name })),
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
      return api.findWebhookEndpoints({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          ...(f.search ? { search: f.search } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.event ? { event: f.event } : {}),
        },
      });
    },
    [api],
  );

  const rotate = useConfirmedAction<[WebhookEndpointResource]>(
    {
      confirm: () => ({
        title: tr("admin.webhooks.rotateTitle", { default: "Rotate secret" }),
        description: tr("admin.webhooks.rotateConfirm", {
          default:
            "A new secret is shown once. The old one keeps signing for 24 hours, so the receiver can switch without losing a delivery.",
        }),
      }),
      handler: async (endpoint) => {
        const rotated = await api.rotateWebhookEndpointSecret({
          params: { id: endpoint.id },
          body: {},
        });
        setSecret(rotated.secret);
        refresh();
      },
    },
    [api, tr],
  );

  const remove = useConfirmedAction<[WebhookEndpointResource]>(
    {
      confirm: () => ({
        title: tr("admin.webhooks.deleteTitle", { default: "Delete endpoint" }),
        description: tr("admin.webhooks.deleteConfirm", {
          default:
            "The endpoint and its delivery log are deleted. This cannot be undone.",
        }),
        destructive: true,
      }),
      handler: async (endpoint) => {
        await api.deleteWebhookEndpoint({ params: { id: endpoint.id } });
        refresh();
      },
      success: tr("admin.webhooks.deleted", { default: "Endpoint deleted" }),
    },
    [api, tr],
  );

  const enable = useAction<[WebhookEndpointResource]>(
    {
      handler: async (_ctx, endpoint) => {
        await api.enableWebhookEndpoint({ params: { id: endpoint.id } });
        toast.success(
          tr("admin.webhooks.enabled", { default: "Endpoint enabled" }),
        );
        refresh();
      },
    },
    [api, toast, tr],
  );

  const sendTest = useAction<[WebhookEndpointResource]>(
    {
      handler: async (_ctx, endpoint) => {
        const { deliveryId } = await api.sendTestWebhook({
          params: { id: endpoint.id },
        });
        setTestDelivery(deliveryId);
      },
    },
    [api],
  );

  return (
    <AdminPage>
      <DataTable<WebhookEndpointResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="admin.webhooks"
        fetch={fetcher}
        refreshSignal={refreshSignal}
        onRowClick={(endpoint) =>
          void router.push("webhookDetail", {
            params: { endpointId: endpoint.id },
          })
        }
        actions={[
          {
            icon: Plus,
            label: tr("admin.webhooks.new", { default: "New endpoint" }),
            primary: true,
            onClick: () => setCreateOpen(true),
          },
        ]}
        filters={{ fields: filterFields }}
        columns={{
          url: {
            label: tr("admin.webhooks.colUrl", { default: "URL" }),
            cell: (endpoint) => <AdminWebhooksUrlCell url={endpoint.url} />,
          },
          description: {
            label: tr("admin.webhooks.colDescription", {
              default: "Description",
            }),
            cell: (endpoint) => (
              <span className="text-muted-foreground text-sm">
                {endpoint.description ?? ""}
              </span>
            ),
          },
          events: {
            label: tr("admin.webhooks.colEvents", { default: "Events" }),
            cell: (endpoint) =>
              endpoint.events.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  {tr("admin.webhooks.allEventsShort", {
                    default: "All events",
                  })}
                </span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {endpoint.events.slice(0, 2).map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                  {endpoint.events.length > 2 ? (
                    <Badge variant="secondary">
                      +{endpoint.events.length - 2}
                    </Badge>
                  ) : null}
                </div>
              ),
          },
          status: {
            label: tr("admin.webhooks.colStatus", { default: "Status" }),
            cell: (endpoint) => (
              <AdminWebhooksStatusBadge endpoint={endpoint} />
            ),
          },
          lastSuccessAt: {
            label: tr("admin.webhooks.colLastSuccess", {
              default: "Last success",
            }),
            cell: (endpoint) =>
              endpoint.lastSuccessAt ? (
                <TimeAgo
                  value={endpoint.lastSuccessAt}
                  className="text-muted-foreground text-xs"
                />
              ) : null,
          },
          failingSince: {
            label: tr("admin.webhooks.colFailingSince", {
              default: "Failing since",
            }),
            cell: (endpoint) =>
              endpoint.failingSince ? (
                <TimeAgo
                  value={endpoint.failingSince}
                  className="text-destructive text-xs"
                />
              ) : null,
          },
        }}
        rowActions={(endpoint) => [
          ...(endpoint.status === "active"
            ? [
                {
                  label: tr("admin.webhooks.pause", { default: "Pause" }),
                  icon: Pause,
                  onClick: (
                    _e: WebhookEndpointResource,
                    ctx: RowActionContext<WebhookEndpointResource>,
                  ) =>
                    undoable.run({
                      message: tr("admin.webhooks.paused", {
                        default: "Endpoint paused",
                      }),
                      apply: () =>
                        ctx.optimistic.patch(endpoint, {
                          ...endpoint,
                          status: "paused",
                        }),
                      commit: () =>
                        api.updateWebhookEndpoint({
                          params: { id: endpoint.id },
                          body: { status: "paused" },
                        }),
                      undo: () =>
                        api.updateWebhookEndpoint({
                          params: { id: endpoint.id },
                          body: { status: "active" },
                        }),
                      onCommitted: ctx.reload,
                      onUndone: ctx.reload,
                    }),
                },
              ]
            : []),
          ...(endpoint.status === "paused"
            ? [
                {
                  label: tr("admin.webhooks.resume", { default: "Resume" }),
                  icon: Play,
                  onClick: (
                    _e: WebhookEndpointResource,
                    ctx: RowActionContext<WebhookEndpointResource>,
                  ) =>
                    undoable.run({
                      message: tr("admin.webhooks.resumed", {
                        default: "Endpoint resumed",
                      }),
                      apply: () =>
                        ctx.optimistic.patch(endpoint, {
                          ...endpoint,
                          status: "active",
                        }),
                      commit: () =>
                        api.updateWebhookEndpoint({
                          params: { id: endpoint.id },
                          body: { status: "active" },
                        }),
                      undo: () =>
                        api.updateWebhookEndpoint({
                          params: { id: endpoint.id },
                          body: { status: "paused" },
                        }),
                      onCommitted: ctx.reload,
                      onUndone: ctx.reload,
                    }),
                },
              ]
            : []),
          ...(endpoint.status === "disabled"
            ? [
                {
                  label: tr("admin.webhooks.enable", { default: "Enable" }),
                  icon: Power,
                  onClick: () => enable.run(endpoint),
                },
              ]
            : []),
          {
            label: tr("admin.webhooks.sendTest", {
              default: "Send test event",
            }),
            icon: Send,
            disabled: (it) => it.status !== "active",
            onClick: () => sendTest.run(endpoint),
          },
          {
            label: tr("admin.webhooks.rotate", { default: "Rotate secret" }),
            icon: KeyRound,
            onClick: () => rotate.run(endpoint),
          },
          {
            label: tr("admin.webhooks.delete", { default: "Delete" }),
            icon: Trash2,
            destructive: true,
            onClick: () => remove.run(endpoint),
          },
        ]}
      />
      <AdminWebhooksCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        events={eventNames}
        onCreated={(created) => {
          setSecret(created.secret);
          refresh();
        }}
      />
      <AdminWebhooksSecretDialog
        secret={secret}
        onClose={() => setSecret(null)}
      />
      <AdminWebhookDeliveryDialog
        deliveryId={testDelivery}
        onClose={() => setTestDelivery(undefined)}
        onRedelivered={refresh}
      />
    </AdminPage>
  );
};

export default AdminWebhooks;
