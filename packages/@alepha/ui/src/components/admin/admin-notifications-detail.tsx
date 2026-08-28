import { AdminNotificationsStatusBadge } from "@alepha/ui/components/admin/admin-notifications-status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import type { AdminNotificationController } from "alepha/api/notifications";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

export interface AdminNotificationsDetailProps {
  notificationId: string | null;
  onClose: () => void;
}

/**
 * Everything known about one message.
 *
 * ⚠️ **Renders with half the data missing, on purpose.** The receipt lives
 * 90 days and the outbox row it points at lives 7, so `variables` and `logs`
 * are simply absent on anything older than the shorter window. That is not
 * an error state and must not look like one. `outboxAvailable` says which
 * case this is.
 *
 * A `sensitive` template withholds subject, body and variables at the
 * backend; nothing here needs to re-filter them.
 */
export const AdminNotificationsDetail = (
  props: AdminNotificationsDetailProps,
) => {
  const client = useClient<AdminNotificationController>();
  const { l, tr } = useI18n();

  const { data: detail } = useQuery(
    {
      handler: ({ signal }) =>
        props.notificationId
          ? client.getNotification(
              { params: { id: props.notificationId } },
              { request: { signal } },
            )
          : Promise.resolve(null),
      onError: () => {},
    },
    [client, props.notificationId],
  );

  return (
    <Sheet
      open={Boolean(props.notificationId)}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {detail?.template ??
              tr("admin.notifications.detailTitle", {
                default: "Notification",
              })}
          </SheetTitle>
          <SheetDescription>{detail?.contact ?? ""}</SheetDescription>
        </SheetHeader>

        {detail ? (
          <div className="space-y-6 px-4 pb-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <AdminNotificationsStatusBadge status={detail.status} />
              {detail.skipReason ? (
                <span className="text-muted-foreground text-xs">
                  {detail.skipReason}
                </span>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailSent", { default: "Sent" })}
              </dt>
              <dd>{String(l(detail.createdAt, { date: "lll" }))}</dd>

              {detail.lastEventAt ? (
                <>
                  <dt className="text-muted-foreground text-xs">
                    {tr("admin.notifications.detailLastEvent", {
                      default: "Last event",
                    })}
                  </dt>
                  <dd>{String(l(detail.lastEventAt, { date: "lll" }))}</dd>
                </>
              ) : null}

              <dt className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailChannel", {
                  default: "Channel",
                })}
              </dt>
              <dd>{detail.type ?? "-"}</dd>

              <dt className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailCategory", {
                  default: "Category",
                })}
              </dt>
              <dd>{detail.category ?? "-"}</dd>

              <dt className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailProvider", {
                  default: "Provider",
                })}
              </dt>
              <dd>{detail.provider ?? "-"}</dd>

              {detail.smtpStatusCode ? (
                <>
                  <dt className="text-muted-foreground text-xs">
                    {tr("admin.notifications.detailSmtpCode", {
                      default: "SMTP code",
                    })}
                  </dt>
                  <dd>{detail.smtpStatusCode}</dd>
                </>
              ) : null}
            </dl>

            {detail.subject ? (
              <div>
                <div className="text-muted-foreground text-xs">
                  {tr("admin.notifications.detailSubject", {
                    default: "Subject",
                  })}
                </div>
                <div>{detail.subject}</div>
              </div>
            ) : null}

            {detail.error ? (
              <div>
                <div className="text-muted-foreground text-xs">
                  {tr("admin.notifications.detailError", { default: "Error" })}
                </div>
                <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                  {detail.error}
                </pre>
              </div>
            ) : null}

            {detail.variables ? (
              <div>
                <div className="text-muted-foreground text-xs">
                  {tr("admin.notifications.detailVariables", {
                    default: "Variables",
                  })}
                </div>
                <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                  {JSON.stringify(detail.variables, null, 2)}
                </pre>
              </div>
            ) : null}

            {detail.outboxAvailable === false ? (
              <p className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailOutboxGone", {
                  default:
                    "The original job record has passed its retention window, so variables and logs are no longer available. The receipt is kept for longer.",
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
