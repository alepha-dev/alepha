import { Badge } from "@alepha/ui/components/ui/badge";

import { useNotificationStatusLabels } from "./admin-notifications-status-labels.ts";
import {
  NOTIFICATION_STATUS_ICON,
  NOTIFICATION_STATUS_TONE,
  type NotificationStatus,
} from "./admin-notifications-status-tones.ts";

export interface AdminNotificationsStatusBadgeProps {
  status?: string;
}

/**
 * A delivery status, coloured and glyphed by what it means to an operator.
 *
 * ⚠️ These are the **receipt** statuses, not the job's. The list used to
 * render `job_executions.status`, which never wrote `sent` or `delivered`, so
 * every badge fell through to the neutral outline and the column said
 * nothing.
 *
 * The tone and the glyph both come from `admin-notifications-status-tones`,
 * which is the single map: the list and the detail sheet cannot then show the
 * same status two different ways.
 */
export const AdminNotificationsStatusBadge = (
  props: AdminNotificationsStatusBadgeProps,
) => {
  const labels = useNotificationStatusLabels();
  const status = (props.status ?? "sent") as NotificationStatus;
  const tone = NOTIFICATION_STATUS_TONE[status];
  const Icon = NOTIFICATION_STATUS_ICON[status];

  return (
    // A status this build does not know about still gets a chip: neutral, no
    // glyph, and its own raw value as the label. A transport can report
    // something newer than the deployed code, and an empty chip reads as a
    // rendering bug rather than as news.
    <Badge variant="tint" tone={tone ?? "neutral"}>
      {Icon ? <Icon className="size-3" /> : null}
      {labels[status] ?? status}
    </Badge>
  );
};
