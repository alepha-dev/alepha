import type { AdminUserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { UsersIcon } from "lucide-react";

import {
  DATA_TABLE_FILTERS_QUERY_KEY,
  DATA_TABLE_NO_STORED_FILTERS,
} from "../table/dataTableQueryKeys.ts";
import { AdminStatTile } from "./AdminStatTile.tsx";

export interface AdminUsersTileProps {
  /**
   * The dashboard card's id, the tile's query key.
   */
  id: string;
}

/**
 * Built-in dashboard tile: every user of the realm, with a chip comparing
 * sign-ups in the last 7 whole UTC days with the 7 before.
 *
 * Links to the whole Users list with `?filters=none`: the link carries no
 * filter, and without the reserved key the admin's stored filters would
 * narrow the list under a tile that counts everyone.
 */
export const AdminUsersTile = (props: AdminUsersTileProps) => {
  const client = useClient<AdminUserController>();
  const { tr } = useI18n();

  return (
    <AdminStatTile
      id={props.id}
      // Same key as the nav entry: the same word on the same subject.
      label={tr("admin.nav.users", { default: "Users" })}
      icon={<UsersIcon className="size-4" />}
      tooltip={tr("admin.dashboard.usersTooltip", {
        default: "Every account in this realm, disabled ones included.",
      })}
      href={`/admin/users?${DATA_TABLE_FILTERS_QUERY_KEY}=${DATA_TABLE_NO_STORED_FILTERS}`}
      load={async () => {
        const stats = await client.getUserStats({ query: { windowDays: 7 } });
        return {
          value: stats.total,
          delta: {
            current: stats.signups.current,
            previous: stats.signups.previous,
            label: tr("admin.dashboard.usersDelta", {
              default: "Sign-ups, last 7 days vs the 7 before",
            }),
          },
        };
      }}
      note={(loaded) =>
        tr("admin.dashboard.usersSignups", {
          count: loaded.delta?.current ?? 0,
          default: {
            one: "{count} sign-up in 7 days",
            other: "{count} sign-ups in 7 days",
          },
        })
      }
    />
  );
};
