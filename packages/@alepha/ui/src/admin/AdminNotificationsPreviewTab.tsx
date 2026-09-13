import { AdminNotificationsPreviewBody } from "@alepha/ui/components/admin/admin-notifications-preview-body";
import type {
  AdminNotificationController,
  NotificationPreviewResource,
} from "alepha/api/notifications";
import { useClient, useQuery } from "alepha/react";

export interface AdminNotificationsPreviewTabProps {
  notificationId: string | null;
  /**
   * Whether this tab is the one on screen. The fetch is skipped until it is,
   * so opening a row never re-renders a template nobody asked to see.
   */
  active: boolean;
}

/**
 * The message itself, re-rendered from its template.
 *
 * ⚠️ **This is not what was delivered, it is what the template produces
 * today.** `storeRenderedBody` is off by default, so most receipts carry no
 * body and the only way to show anything is to run the template again. If it
 * has changed since the send the preview changes with it, which the banner in
 * {@link AdminNotificationsPreviewBody} says out loud rather than implying a
 * fidelity it does not have.
 *
 * The endpoint answers 200 with a reason rather than throwing when there is
 * nothing to show: retention and a sensitive template are expected states,
 * not errors.
 */
export const AdminNotificationsPreviewTab = (
  props: AdminNotificationsPreviewTabProps,
) => {
  const client = useClient<AdminNotificationController>();

  const { data: preview } = useQuery<NotificationPreviewResource | null>(
    {
      handler: ({ signal }) =>
        props.active && props.notificationId
          ? (client.previewNotification(
              { params: { id: props.notificationId } },
              { request: { signal } },
            ) as any)
          : Promise.resolve(null),
      onError: () => {},
    },
    [client, props.notificationId, props.active],
  );

  if (!preview) {
    return null;
  }

  return <AdminNotificationsPreviewBody preview={preview} />;
};
