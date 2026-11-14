import type { AdminUserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { UserCheck } from "lucide-react";

import { AdminStatTile } from "./AdminStatTile.tsx";

export interface AdminConnectedTileProps {
  /**
   * The dashboard card's id, the tile's query key.
   */
  id: string;
}

/**
 * Built-in dashboard tile: distinct users of the realm who signed in or
 * refreshed a session in the last 24 hours.
 *
 * No chip: `sessions.lastUsedAt` is overwritten on each refresh, so the
 * previous 24 hours cannot be counted after the fact. Links to the Users list
 * filtered by the same predicate (`?active=24`), so the list totals the tile.
 */
export const AdminConnectedTile = (props: AdminConnectedTileProps) => {
  const client = useClient<AdminUserController>();
  const { tr } = useI18n();

  return (
    <AdminStatTile
      id={props.id}
      label={tr("admin.dashboard.connected", { default: "Connected" })}
      icon={<UserCheck className="size-4" />}
      tooltip={tr("admin.dashboard.connectedTooltip", {
        default:
          "Distinct users who signed in or refreshed a session in the last 24 hours, API keys not included.",
      })}
      note={tr("admin.dashboard.connectedNote", {
        default: "Signed in or refreshed in the last 24 hours.",
      })}
      href="/admin/users?active=24"
      load={async () =>
        (await client.getUserStats({ query: { connectedHours: 24 } })).connected
      }
    />
  );
};
