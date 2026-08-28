import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  AdminNotificationController,
  NotificationSuppressionResource,
} from "alepha/api/notifications";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Undo2 } from "lucide-react";
import { useCallback } from "react";

/**
 * Addresses the app will not mail, and why.
 *
 * ⚠️ Lifting one **re-enables mail to someone who said no** - or to an
 * address that hard bounced, which is what costs a sending domain its
 * reputation. That is why the action is gated on `admin:notification:write`
 * and not on the resend permission, and why it confirms first.
 */
export const AdminNotificationsSuppressions = () => {
  const client = useClient<AdminNotificationController>();
  const toast = useToast();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      return client.listSuppressions({ query: params });
    },
    [client],
  );

  const lift = useConfirmedAction<
    [NotificationSuppressionResource, { refresh: () => void }]
  >(
    {
      confirm: (row) => ({
        title: tr("admin.notifications.liftTitle", {
          default: "Resume sending",
        }),
        description: tr("admin.notifications.liftConfirm", {
          default: `Start sending to ${row.contact} again? They unsubscribed, bounced or complained.`,
          args: [row.contact],
        }),
        destructive: true,
      }),
      handler: async (row, ctx) => {
        await client.liftSuppression({ params: { id: row.id } });
        toast.success(
          tr("admin.notifications.lifted", { default: "Suppression lifted" }),
        );
        ctx.refresh();
      },
    },
    [client, toast, tr],
  );

  return (
    <AlephaTable<NotificationSuppressionResource>
      className="min-h-0 flex-1"
      persistenceKey="admin.notifications.suppressions"
      fetch={fetcher}
      rowActions={() => [
        {
          label: tr("admin.notifications.lift", { default: "Resume sending" }),
          icon: Undo2,
          destructive: true,
          onClick: (row, ctx) => lift.run(row, ctx),
        },
      ]}
      columns={{
        contact: {
          label: tr("admin.notifications.colContact", { default: "Contact" }),
          cell: (row) => <span className="text-sm">{row.contact}</span>,
        },
        channel: {
          label: tr("admin.notifications.colChannel", { default: "Channel" }),
          cell: (row) => <Badge variant="secondary">{row.channel}</Badge>,
        },
        reason: {
          label: tr("admin.notifications.colReason", { default: "Reason" }),
          cell: (row) => (
            <Badge
              variant={
                (row.reason === "unsubscribed"
                  ? "outline"
                  : "destructive") as never
              }
            >
              {row.reason}
            </Badge>
          ),
        },
        category: {
          label: tr("admin.notifications.colCategory", {
            default: "Category",
          }),
          cell: (row) => (
            <span className="text-sm">
              {row.category === "*"
                ? tr("admin.notifications.allCategories", {
                    default: "All",
                  })
                : row.category}
            </span>
          ),
        },
        source: {
          label: tr("admin.notifications.colSource", { default: "Source" }),
          cell: (row) => (
            <span className="text-muted-foreground text-xs">{row.source}</span>
          ),
        },
        createdAt: {
          label: tr("admin.notifications.colSince", { default: "Since" }),
          sortable: true,
          cell: (row) => (
            <span className="text-muted-foreground text-xs">
              {String(l(row.createdAt, { date: "fromNow" }))}
            </span>
          ),
        },
      }}
    />
  );
};
