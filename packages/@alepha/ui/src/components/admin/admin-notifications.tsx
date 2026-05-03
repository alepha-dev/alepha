import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import type { Page } from "alepha";
import type { AdminNotificationController } from "alepha/api/notifications";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

export function AdminNotifications() {
  const client = useClient<AdminNotificationController>();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findNotifications({ query: params as never });
      return res as Page<any>;
    },
    [client],
  );

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">
              {tr("admin.notifications.title", { default: "Notifications" })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr("admin.notifications.subtitle", {
                default: "Delivery log for emails, SMS, and other channels.",
              })}
            </p>
          </div>
        }
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
          channel: {
            label: tr("admin.notifications.colChannel", { default: "Channel" }),
            cell: (n) => <Badge variant="secondary">{n.channel ?? "—"}</Badge>,
          },
          recipient: {
            label: tr("admin.notifications.colRecipient", {
              default: "Recipient",
            }),
            cell: (n) => <span className="text-sm">{n.recipient ?? "—"}</span>,
          },
          subject: {
            label: tr("admin.notifications.colSubject", { default: "Subject" }),
            cell: (n) => <span className="text-sm">{n.subject ?? "—"}</span>,
          },
          status: {
            label: tr("admin.notifications.colStatus", { default: "Status" }),
            cell: (n) => {
              const s = n.status ?? "pending";
              const variant =
                s === "sent" || s === "delivered"
                  ? "default"
                  : s === "failed"
                    ? "destructive"
                    : "outline";
              return <Badge variant={variant as never}>{s}</Badge>;
            },
          },
        }}
      />
    </div>
  );
}
