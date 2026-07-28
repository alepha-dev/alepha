import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  AdminNotificationController,
  NotificationResource,
} from "alepha/api/notifications";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";

export function AdminNotifications() {
  const client = useClient<AdminNotificationController>();
  const toast = useToast();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      return client.findNotifications({ query: params });
    },
    [client],
  );

  const bulkDelete = useConfirmedAction<
    [
      NotificationResource[],
      { clearSelection: () => void; refresh: () => void },
    ]
  >(
    {
      confirm: (items) => ({
        title: tr("admin.notifications.bulkDeleteTitle", {
          default: "Delete notifications",
        }),
        description: tr("admin.notifications.bulkDeleteConfirm", {
          default: `Delete ${items.length} notification record(s)? This cannot be undone.`,
          args: [String(items.length)],
        }),
        destructive: true,
      }),
      handler: async (items, ctx) => {
        if (items.length === 0) return;
        const res = await client.deleteNotifications({
          body: { ids: items.map((n) => n.id) },
        });
        toast.success(
          tr("admin.notifications.bulkDeleted", {
            default: `${res.deleted.length} notification(s) deleted`,
            args: [String(res.deleted.length)],
          }),
        );
        ctx.clearSelection();
        ctx.refresh();
      },
    },
    [client, toast, tr],
  );

  return (
    <AdminPage>
      <AlephaTable<NotificationResource>
        className="min-h-0 flex-1"
        persistenceKey="admin.notifications"
        fetch={fetcher}
        bulkActions={[
          {
            label: tr("admin.notifications.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: (items, ctx) => bulkDelete.run(items, ctx),
          },
        ]}
        columns={{
          createdAt: {
            label: tr("admin.notifications.colWhen", { default: "When" }),
            sortable: true,
            cell: (n) => (
              <span className="text-muted-foreground text-xs">
                {String(l(n.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          type: {
            label: tr("admin.notifications.colType", { default: "Type" }),
            cell: (n) => <Badge variant="secondary">{n.type ?? "—"}</Badge>,
          },
          contact: {
            label: tr("admin.notifications.colRecipient", {
              default: "Recipient",
            }),
            cell: (n) => <span className="text-sm">{n.contact ?? "—"}</span>,
          },
          template: {
            label: tr("admin.notifications.colTemplate", {
              default: "Template",
            }),
            cell: (n) => <span className="text-sm">{n.template ?? "—"}</span>,
          },
          status: {
            label: tr("admin.notifications.colStatus", { default: "Status" }),
            cell: (n) => {
              // `job_executions.status` — the outbox never wrote
              // "sent"/"delivered"/"failed", so every badge used to fall
              // through to the neutral outline variant.
              const s = n.status ?? "pending";
              const variant =
                s === "ok"
                  ? "default"
                  : s === "error"
                    ? "destructive"
                    : "outline";
              return <Badge variant={variant as never}>{s}</Badge>;
            },
          },
        }}
      />
    </AdminPage>
  );
}

export default AdminNotifications;
