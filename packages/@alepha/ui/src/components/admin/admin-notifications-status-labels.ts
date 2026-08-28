import { useI18n } from "alepha/react/i18n";

import type { NotificationStatus } from "./admin-notifications-status-tones.ts";

/**
 * Localised delivery status labels, keyed by status.
 *
 * ⚠️ One literal `tr()` per status, and never
 * ``tr(`admin.notifications.status.${status}`)``. A computed key is invisible
 * to `i18n-fr.spec.ts`, which finds keys by matching a literal after `tr(`,
 * so the French entries could not be added at all: the spec would report
 * every one of them as a translation nothing asks for, and the statuses would
 * render in English inside a French UI. Same trap `admin-jobs-status-labels`
 * documents.
 *
 * A record rather than a function, because both callers want the whole set:
 * the filter lists it, the badge indexes it.
 */
export const useNotificationStatusLabels = (): Record<
  NotificationStatus,
  string
> => {
  const { tr } = useI18n();
  return {
    sent: tr("admin.notifications.status.sent", { default: "Sent" }),
    delivered: tr("admin.notifications.status.delivered", {
      default: "Delivered",
    }),
    deferred: tr("admin.notifications.status.deferred", {
      default: "Deferred",
    }),
    bounced: tr("admin.notifications.status.bounced", { default: "Bounced" }),
    complained: tr("admin.notifications.status.complained", {
      default: "Complained",
    }),
    failed: tr("admin.notifications.status.failed", { default: "Failed" }),
    rejected: tr("admin.notifications.status.rejected", {
      default: "Rejected",
    }),
    skipped: tr("admin.notifications.status.skipped", { default: "Skipped" }),
  };
};
