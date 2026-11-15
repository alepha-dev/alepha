import type { AdminAuditController } from "alepha/api/audits";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ShieldAlert } from "lucide-react";

import {
  adminAuditDayRange,
  adminDashboardDayWindow,
} from "./adminDashboardWindows.ts";
import { AdminStatTile } from "./AdminStatTile.tsx";

export interface AdminFailedAuditsTileProps {
  /**
   * The dashboard card's id, the tile's query key.
   */
  id: string;

  /**
   * The tile turns warning-coloured above this many failures in the window.
   *
   * @default 10
   */
  alertThreshold?: number;
}

/**
 * Built-in dashboard tile: every failed audit (`success: false`, whatever its
 * type) over the last 7 whole UTC days, with a chip against the 7 before, and
 * the warning tone above a threshold (a lockout writes two rows, so "above 0"
 * would be noise).
 *
 * It counted only the `auth` and `security` types, the sign-in paths, until
 * #Q3668: an app's own `$audit.logFailure` is a failure an admin wants on the
 * same glance, not one to leave out.
 *
 * Links to the audit log filtered to exactly what it counted: failed, every
 * type, the same days.
 */
export const AdminFailedAuditsTile = (props: AdminFailedAuditsTileProps) => {
  const client = useClient<AdminAuditController>();
  const alepha = useAlepha();
  const { tr } = useI18n();
  const threshold = props.alertThreshold ?? 10;
  const days = adminDashboardDayWindow(
    alepha.inject(DateTimeProvider).nowMillis(),
    7,
  );

  const count = async (fromDay: string, toDay: string) =>
    (
      await client.findAudits({
        query: {
          success: false,
          size: 1,
          ...adminAuditDayRange(fromDay, toDay),
        },
      })
    ).page.totalElements ?? 0;

  return (
    <AdminStatTile
      id={props.id}
      label={tr("admin.dashboard.failedAudits", {
        default: "Failed audits",
      })}
      icon={<ShieldAlert className="size-4" />}
      tooltip={tr("admin.dashboard.failedAuditsTooltip", {
        default:
          "Audits of every type that failed (wrong password or code, blocked or rate-limited attempts, and the app's own failures), over the last 7 days in UTC. A lockout writes two.",
      })}
      note={tr("admin.dashboard.failedAuditsNote", {
        default: "Last 7 days, UTC.",
      })}
      previousLabel={tr("admin.dashboard.failedAuditsDelta", {
        default: "Last 7 days vs the 7 before",
      })}
      href={`/admin/audits?status=failed&createdAt=${days.from},${days.to}`}
      alert={(value) => value > threshold}
      load={async () => {
        const [value, previous] = await Promise.all([
          count(days.from, days.to),
          count(days.previousFrom, days.previousTo),
        ]);
        return { value, previous };
      }}
    />
  );
};
