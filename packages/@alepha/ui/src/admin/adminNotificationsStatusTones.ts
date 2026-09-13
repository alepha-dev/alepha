import type { BadgeTone } from "@alepha/ui/components/ui/badge";
import type { NotificationQuery } from "alepha/api/notifications";
import {
  Ban,
  CheckCheck,
  CircleMinus,
  CircleX,
  Clock,
  MailX,
  Send,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

/**
 * One delivery status.
 *
 * Taken from the query schema and NOT from `notificationDeliveryEntity`: the
 * module's browser entry exports its schemas only, so importing the entity
 * here would pull `alepha/orm` into the client bundle for a type. The two
 * enums are held equal by `statusFilter.spec.ts`.
 */
export type NotificationStatus = NonNullable<NotificationQuery["status"]>;

/**
 * The delivery vocabulary, in the order the filter offers it: the happy path
 * first, then the states that need an operator, then the one that needs
 * nobody.
 *
 * The list, the filter and the badge all need the set, and a hand-kept copy
 * in each of them is how one ends up missing a status.
 * `admin-status-labels.browser.spec.tsx` holds it equal to the query schema's.
 */
export const NOTIFICATION_STATUSES: NotificationStatus[] = [
  "sent",
  "delivered",
  "deferred",
  "bounced",
  "complained",
  "failed",
  "rejected",
  "skipped",
];

/**
 * The tone each delivery status wears.
 *
 * ⚠️ `skipped` is deliberately NOT a failure. The gate refusing to mail
 * someone who unsubscribed is the system working, and tinting it like a
 * bounce sends operators hunting for a problem that is not there.
 *
 * `sent` and `delivered` are deliberately different: "the provider accepted
 * it" and "the transport confirmed it" are not the same claim, and the old
 * badge collapsed them into one neutral outline.
 */
export const NOTIFICATION_STATUS_TONE: Record<NotificationStatus, BadgeTone> = {
  sent: "info",
  delivered: "success",
  deferred: "warning",
  bounced: "danger",
  complained: "danger",
  failed: "danger",
  rejected: "danger",
  skipped: "neutral",
};

/**
 * The glyph each status wears.
 *
 * Not decoration: four statuses share the `danger` tone, so colour alone
 * cannot tell a bounce from a complaint. The glyph is what carries that, and
 * it is also what keeps the column readable in monochrome and for a reader
 * who cannot separate the hues.
 */
export const NOTIFICATION_STATUS_ICON: Record<NotificationStatus, LucideIcon> =
  {
    sent: Send,
    delivered: CheckCheck,
    deferred: Clock,
    bounced: MailX,
    complained: ShieldAlert,
    failed: CircleX,
    rejected: Ban,
    skipped: CircleMinus,
  };
