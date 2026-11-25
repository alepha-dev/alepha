import type { SubscriptionResource } from "../../../../../../api/schemas/subscriptionResourceSchema.ts";

/**
 * One row of the Notifications table (#Q3912): a subscription, with what the
 * table shows, filters and groups on resolved once, so the static table's
 * matching, sorting and grouping read plain fields.
 *
 * `recipient` is `member:<id>` or `channel:<id>`, the value the Who filter
 * and the add dialog's Notify picker both use. `how` holds `inapp` and
 * `email` for a member, `channel` for a channel row.
 */
export interface NotificationTableRow {
  id: string;
  subscription: SubscriptionResource;
  event: string;
  eventLabel: string;
  resource: string;
  available: boolean;
  reason?: string;
  recipient: string;
  recipientLabel: string;
  recipientKind: "member" | "discord" | "webhook" | "channel";
  mine: boolean;
  filterResource?: string;
  filterLabel?: string;
  how: string[];
  status: "active" | "paused";
}
