import { AdminNotificationsDetailTabs } from "@alepha/ui/components/admin/admin-notifications-detail-tabs";
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

// Relative: the package's `components/*` subpath export maps to `.tsx`, so a
// plain `.ts` sibling only resolves this way.
import { notificationTemplateLabel } from "./admin-notifications-template-label.ts";

export interface AdminNotificationsDetailProps {
  notificationId: string | null;
  /**
   * Which tab to open on. The list's "Raw data" action opens straight onto
   * `raw` rather than making the reader find it.
   */
  initialTab?: string;
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
  const { tr } = useI18n();

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
      {/* Wider than the rest of the admin's sheets: this one has to fit a
          rendered email, and an email is authored for a real column width. */}
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-3xl">
        <SheetHeader>
          {/* Humanized through the same helper the list uses. Showing
              `invitationInvite` here while the row that opened it says
              "Invitation invite" makes one template look like two. The raw
              name stays reachable in the Raw tab. */}
          <SheetTitle title={detail?.template}>
            {detail?.template
              ? notificationTemplateLabel(detail.template)
              : tr("admin.notifications.detailTitle", {
                  default: "Notification",
                })}
          </SheetTitle>
          <SheetDescription>{detail?.contact ?? ""}</SheetDescription>
        </SheetHeader>

        {detail && props.notificationId ? (
          // Keyed on the row AND the requested tab: the sheet stays mounted
          // between rows, so without this a "Raw data" click on a second row
          // would land on whatever tab the previous one was left on. A key is
          // the remount, which is how the tab state re-initialises without an
          // effect that sets state.
          <AdminNotificationsDetailTabs
            key={`${props.notificationId}:${props.initialTab ?? "details"}`}
            notificationId={props.notificationId}
            detail={detail}
            initialTab={props.initialTab ?? "details"}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
