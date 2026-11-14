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

export interface AdminFailedSignInsTileProps {
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
 * The audit types the tile counts. Every `success: false` audit the
 * framework writes today is a sign-in path (login, MFA, a blocked or
 * rate-limited attempt), under these two types; counting every failed audit
 * instead would let any app module's `$audit.logFailure` into the number.
 */
const FAILED_SIGN_IN_TYPES = ["auth", "security"] as const;

/**
 * Built-in dashboard tile: failed sign-ins over the last 7 whole UTC days,
 * with a chip against the 7 before, and the warning tone above a threshold
 * (a lockout writes two rows, so "above 0" would be noise).
 *
 * Links to the audit log filtered to exactly what it counted: the two types,
 * failed, and the same days.
 */
export const AdminFailedSignInsTile = (props: AdminFailedSignInsTileProps) => {
  const client = useClient<AdminAuditController>();
  const alepha = useAlepha();
  const { tr } = useI18n();
  const threshold = props.alertThreshold ?? 10;
  const days = adminDashboardDayWindow(
    alepha.inject(DateTimeProvider).nowMillis(),
    7,
  );
  const type = FAILED_SIGN_IN_TYPES.join(",");

  const count = async (fromDay: string, toDay: string) =>
    (
      await client.findAudits({
        query: {
          type,
          success: false,
          size: 1,
          ...adminAuditDayRange(fromDay, toDay),
        },
      })
    ).page.totalElements ?? 0;

  return (
    <AdminStatTile
      id={props.id}
      label={tr("admin.dashboard.failedSignIns", {
        default: "Failed sign-ins",
      })}
      icon={<ShieldAlert className="size-4" />}
      tooltip={tr("admin.dashboard.failedSignInsTooltip", {
        default:
          "Sign-in and security audits that failed (wrong password or code, blocked or rate-limited attempts), over the last 7 days in UTC. A lockout writes two.",
      })}
      note={tr("admin.dashboard.failedSignInsNote", {
        default: "Last 7 days, UTC.",
      })}
      previousLabel={tr("admin.dashboard.failedSignInsDelta", {
        default: "Last 7 days vs the 7 before",
      })}
      href={`/admin/audits?status=failed&type=${type}&createdAt=${days.from},${days.to}`}
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
