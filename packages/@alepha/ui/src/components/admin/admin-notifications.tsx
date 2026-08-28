import { AdminNotificationsDetail } from "@alepha/ui/components/admin/admin-notifications-detail";
import { AdminNotificationsStatusBadge } from "@alepha/ui/components/admin/admin-notifications-status-badge";
import { AdminNotificationsSuppressions } from "@alepha/ui/components/admin/admin-notifications-suppressions";
import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@alepha/ui/components/ui/tabs";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  AdminNotificationController,
  NotificationResource,
} from "alepha/api/notifications";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Send, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * What the app sent, what happened to it, and who it may not send to.
 *
 * ⚠️ **The list is the delivery receipts, not the job outbox.** Two tables
 * with two retention clocks cannot be paged as one. The consequence is that
 * notifications pushed before receipts existed have none and do not appear,
 * which the empty state says rather than hiding.
 *
 * No polling anywhere on this page: the table's own refresh is the way to
 * get fresh data. A polling effect keyed on an unstable object is what
 * burned 4k Worker invocations once already.
 */
export const AdminNotifications = () => {
  const client = useClient<AdminNotificationController>();
  const toast = useToast();
  const { l, tr } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);

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

  const resend = useConfirmedAction<
    [NotificationResource, { refresh: () => void }]
  >(
    {
      confirm: (row) => ({
        title: tr("admin.notifications.resendTitle", { default: "Resend" }),
        description: tr("admin.notifications.resendConfirm", {
          default: `Send this notification to ${row.contact} again?`,
          args: [row.contact ?? ""],
        }),
      }),
      handler: async (row, ctx) => {
        await client.resendNotification({ params: { id: row.id } });
        // It goes back through the suppression gate, so "queued" is the
        // honest word: a suppressed contact will get a second `skipped`
        // receipt rather than a message.
        toast.success(
          tr("admin.notifications.resent", {
            default: "Queued. It passes the suppression gate again.",
          }),
        );
        ctx.refresh();
      },
    },
    [client, toast, tr],
  );

  return (
    <AdminPage>
      <Tabs defaultValue="messages" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="messages">
            {tr("admin.notifications.tabMessages", { default: "Messages" })}
          </TabsTrigger>
          {client.listSuppressions.can() ? (
            <TabsTrigger value="suppressions">
              {tr("admin.notifications.tabSuppressions", {
                default: "Suppressions",
              })}
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="messages" className="flex min-h-0 flex-1 flex-col">
          <AlephaTable<NotificationResource>
            className="min-h-0 flex-1"
            persistenceKey="admin.notifications"
            fetch={fetcher}
            onRowClick={(n) => setSelected(n.id)}
            rowActions={() =>
              client.resendNotification.can()
                ? [
                    {
                      label: tr("admin.notifications.resend", {
                        default: "Resend",
                      }),
                      icon: Send,
                      onClick: (row, ctx) => resend.run(row, ctx),
                    },
                  ]
                : []
            }
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
                cell: (n) => <Badge variant="secondary">{n.type ?? "-"}</Badge>,
              },
              contact: {
                label: tr("admin.notifications.colRecipient", {
                  default: "Recipient",
                }),
                cell: (n) => (
                  <span className="text-sm">{n.contact ?? "-"}</span>
                ),
              },
              template: {
                label: tr("admin.notifications.colTemplate", {
                  default: "Template",
                }),
                cell: (n) => (
                  <span className="text-sm">{n.template ?? "-"}</span>
                ),
              },
              status: {
                label: tr("admin.notifications.colStatus", {
                  default: "Status",
                }),
                cell: (n) => (
                  <AdminNotificationsStatusBadge status={n.status} />
                ),
              },
            }}
          />
        </TabsContent>

        {client.listSuppressions.can() ? (
          <TabsContent
            value="suppressions"
            className="flex min-h-0 flex-1 flex-col"
          >
            <AdminNotificationsSuppressions />
          </TabsContent>
        ) : null}
      </Tabs>

      <AdminNotificationsDetail
        notificationId={selected}
        onClose={() => setSelected(null)}
      />
    </AdminPage>
  );
};

export default AdminNotifications;
