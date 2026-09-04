import { AdminNotificationsDetail } from "@alepha/ui/components/admin/admin-notifications-detail";
import { AdminNotificationsStatusBadge } from "@alepha/ui/components/admin/admin-notifications-status-badge";
import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { AdminUserCell } from "@alepha/ui/components/admin/admin-user-cell";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import type {
  AdminNotificationController,
  NotificationResource,
  NotificationTemplateResource,
} from "alepha/api/notifications";
import type { AdminUserController } from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Braces,
  CircleDot,
  FileText,
  Radio,
  Search,
  Send,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useState } from "react";

import { notificationChannelLabel } from "./admin-notifications-channel-label.ts";
// Relative, not through the `@alepha/ui/components/*` alias: that subpath
// pattern maps to `.tsx`, so a plain `.ts` sibling only resolves this way.
import { useNotificationStatusLabels } from "./admin-notifications-status-labels.ts";
import { NOTIFICATION_STATUSES } from "./admin-notifications-status-tones.ts";
import { notificationTemplateLabel } from "./admin-notifications-template-label.ts";

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
  const userClient = useClient<AdminUserController>();
  const toast = useToast();
  const router = useRouter();
  const { l, tr } = useI18n();
  const statusLabels = useNotificationStatusLabels();
  const [selected, setSelected] = useState<{ id: string; tab: string } | null>(
    null,
  );

  /**
   * Contacts resolved to user records, accumulated across pages.
   *
   * Keyed on the contact string because that is all a receipt carries: it
   * stores an email or a phone number and never a user id. Resolving happens
   * client-side because `api/notifications` may not import `api/users`.
   */
  const [usersByContact, setUsersByContact] = useState<
    Record<string, { id: string; email?: string; username?: string }>
  >({});

  /**
   * The catalogue this app can send, for the template and category filters.
   *
   * Falls back to an empty list on any failure, including a missing
   * permission: a filter that cannot offer its options should narrow to
   * nothing rather than break the page around it.
   */
  const { data: templates } = useQuery<NotificationTemplateResource[]>(
    {
      handler: ({ signal }) =>
        client.listNotificationTemplates.can()
          ? (client.listNotificationTemplates(
              {},
              { request: { signal } },
            ) as any)
          : Promise.resolve([]),
      onError: () => {},
    },
    [client],
  );

  /**
   * Resolve this page's email contacts to users, in ONE request.
   *
   * Per page and not per row: a 25-row page would otherwise be 25 requests.
   * Phone contacts are skipped outright, since they can never match an email
   * column. Every failure is swallowed: the column falls back to the raw
   * contact string, which is still the truth.
   */
  const resolveUsers = useCallback(
    (rows: NotificationResource[]) => {
      if (!userClient.findUsers.can()) return;
      const emails = [
        ...new Set(
          rows
            .filter((row) => row.type === "email" && row.contact)
            .map((row) => row.contact as string),
        ),
      ];
      if (emails.length === 0) return;

      userClient
        .findUsers({ query: { emails, size: Math.min(emails.length, 100) } })
        .then((page) => {
          setUsersByContact((previous) => ({
            ...previous,
            ...Object.fromEntries(
              page.content
                .filter((user) => user.email)
                .map((user) => [user.email as string, user]),
            ),
          }));
        })
        .catch(() => {});
    },
    [userClient],
  );

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: Record<string, any>;
    }) => {
      const f = params.filters ?? {};
      const page = await client.findNotifications({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          // Spread in, never assigned as undefined: the repository refuses an
          // undefined value in a where-filter.
          ...(f.search ? { search: f.search } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.channel ? { channel: f.channel } : {}),
          ...(f.template ? { template: f.template } : {}),
        } as any,
      });
      resolveUsers(page.content);
      return page;
    },
    [client, resolveUsers],
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

  const remove = useConfirmedAction<
    [NotificationResource, { refresh: () => void }]
  >(
    {
      confirm: () => ({
        title: tr("admin.notifications.deleteTitle", {
          default: "Delete notification",
        }),
        description: tr("admin.notifications.deleteConfirm", {
          default: "Delete this notification record? This cannot be undone.",
        }),
        destructive: true,
      }),
      handler: async (row, ctx) => {
        await client.deleteNotification({ params: { id: row.id } });
        toast.success(
          tr("admin.notifications.deleted", {
            default: "Notification deleted",
          }),
        );
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
        onRowClick={(n) => setSelected({ id: n.id, tab: "details" })}
        filters={{
          schema: z.object({
            search: z.text().optional(),
            status: z.enum(NOTIFICATION_STATUSES as [string]).optional(),
            // Open, like the column behind it. A closed enum here would
            // reject `?channel=discord` outright, so a plugin's channel
            // would be listed in the table and unfilterable.
            channel: z.text().optional(),
            template: z.text().optional(),
          }),
          render: (form) => (
            <>
              <div className="w-52">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("admin.notifications.filterSearch", {
                    default: "Recipient",
                  })}
                  inputProps={{
                    "aria-label": tr("admin.notifications.filterSearch", {
                      default: "Recipient",
                    }),
                  }}
                />
              </div>
              <div className="w-44">
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={tr("admin.notifications.allStatuses", {
                    default: "All statuses",
                  })}
                  triggerClassName="w-full"
                  items={NOTIFICATION_STATUSES.map((status) => ({
                    label: statusLabels[status],
                    value: status,
                  }))}
                  inputProps={{
                    "aria-label": tr("admin.notifications.colStatus", {
                      default: "Status",
                    }),
                  }}
                />
              </div>
              <div className="w-40">
                <Control
                  input={form.input.channel}
                  label=""
                  clearable
                  icon={Radio}
                  clearLabel={tr("admin.notifications.allChannels", {
                    default: "All channels",
                  })}
                  triggerClassName="w-full"
                  // Derived from the templates this app registers, which
                  // already carry their own channel list. A hand-written
                  // pair could only ever offer the two the framework ships.
                  items={[
                    ...new Set((templates ?? []).flatMap((t) => t.channels)),
                  ].map((channel) => ({
                    label: notificationChannelLabel(channel),
                    value: channel,
                  }))}
                  inputProps={{
                    "aria-label": tr("admin.notifications.colChannel", {
                      default: "Channel",
                    }),
                  }}
                />
              </div>
              {(templates ?? []).length > 0 && (
                <div className="w-52">
                  <Control
                    input={form.input.template}
                    label=""
                    clearable
                    icon={FileText}
                    clearLabel={tr("admin.notifications.allTemplates", {
                      default: "All templates",
                    })}
                    triggerClassName="w-full"
                    items={(templates ?? []).map((template) => ({
                      label: notificationTemplateLabel(template.name),
                      value: template.name,
                    }))}
                    inputProps={{
                      "aria-label": tr("admin.notifications.colTemplate", {
                        default: "Template",
                      }),
                    }}
                  />
                </div>
              )}
            </>
          ),
        }}
        rowActions={(row) => {
          const user = row.contact ? usersByContact[row.contact] : undefined;
          return [
            ...(client.resendNotification.can()
              ? [
                  {
                    label: tr("admin.notifications.resend", {
                      default: "Resend",
                    }),
                    icon: Send,
                    // The original payload lives in the outbox, which is
                    // purged long before the receipt. Offering a resend
                    // that can only 404 reads as a broken button.
                    disabled: (item: NotificationResource) =>
                      item.outboxAvailable === false,
                    onClick: (
                      item: NotificationResource,
                      ctx: { refresh: () => void },
                    ) => resend.run(item, ctx),
                  },
                ]
              : []),
            {
              label: tr("admin.notifications.rawData", {
                default: "Raw data",
              }),
              icon: Braces,
              onClick: (item: NotificationResource) =>
                setSelected({ id: item.id, tab: "raw" }),
            },
            ...(user
              ? [
                  {
                    label: tr("admin.notifications.openUser", {
                      default: "Open user",
                    }),
                    icon: UserRound,
                    onClick: () => router.push(`/admin/users/${user.id}`),
                  },
                ]
              : []),
            ...(client.deleteNotification.can()
              ? [
                  {
                    label: tr("admin.notifications.delete", {
                      default: "Delete",
                    }),
                    icon: Trash2,
                    destructive: true,
                    onClick: (
                      item: NotificationResource,
                      ctx: { refresh: () => void },
                    ) => remove.run(item, ctx),
                  },
                ]
              : []),
          ];
        }}
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
          status: {
            label: tr("admin.notifications.colStatus", {
              default: "Status",
            }),
            // First, because it is the only column an operator scans
            // before deciding whether the row is interesting at all.
            className: "pl-4",
            sortable: true,
            cell: (n) => <AdminNotificationsStatusBadge status={n.status} />,
          },
          createdAt: {
            label: tr("admin.notifications.colWhen", { default: "When" }),
            sortable: true,
            cell: (n) => (
              <span className="text-muted-foreground text-xs">
                {String(l(n.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          contact: {
            label: tr("admin.notifications.colRecipient", {
              default: "Recipient",
            }),
            cell: (n) => {
              const user = n.contact ? usersByContact[n.contact] : undefined;
              // A contact that is not a user is normal, not a gap: a
              // notification can go to an address nobody signed up with.
              return user ? (
                <AdminUserCell
                  userId={user.id}
                  user={user}
                  fallbackLabel={n.contact}
                />
              ) : (
                <span className="text-sm">{n.contact ?? "-"}</span>
              );
            },
          },
          template: {
            label: tr("admin.notifications.colTemplate", {
              default: "Template",
            }),
            sortable: true,
            cell: (n) => (
              // Humanized for reading, raw on hover: the raw name is the
              // identifier an operator greps the codebase for.
              <span className="text-sm" title={n.template}>
                {n.template ? notificationTemplateLabel(n.template) : "-"}
              </span>
            ),
          },
          category: {
            label: tr("admin.notifications.colCategory", {
              default: "Category",
            }),
            cell: (n) =>
              n.category ? (
                <Badge variant="secondary">{n.category}</Badge>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          type: {
            // The column KEY stays `type`: AlephaTable persists column
            // visibility under it, and renaming would silently drop every
            // operator's stored preference. Only the label moves, to match
            // what the detail sheet has always called it.
            label: tr("admin.notifications.colChannel", {
              default: "Channel",
            }),
            cell: (n) => <Badge variant="secondary">{n.type ?? "-"}</Badge>,
          },
        }}
      />

      <AdminNotificationsDetail
        notificationId={selected?.id ?? null}
        initialTab={selected?.tab}
        onClose={() => setSelected(null)}
      />
    </AdminPage>
  );
};

export default AdminNotifications;
