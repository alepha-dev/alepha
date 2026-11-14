import { adminDashboardDayWindow, AdminStatTile } from "@alepha/ui/admin";
import type { AdminProjectController } from "@lore/core/api";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { FolderKanban } from "lucide-react";

export interface AdminProjectsTileProps {
  /**
   * The dashboard card's id, the tile's query key.
   */
  id: string;
}

/**
 * Lore's dashboard tile: the projects on this instance, archived ones
 * excluded, with a chip comparing projects created in the last 7 whole UTC
 * days with the 7 before.
 *
 * Three `size: 1` pages of `findProjects` (the total, this window, the one
 * before): no count action of its own. Links to the admin Projects page with
 * the same archived filter, so the list totals the tile.
 */
export const AdminProjectsTile = (props: AdminProjectsTileProps) => {
  const client = useClient<AdminProjectController>();
  const alepha = useAlepha();
  const { tr } = useI18n();
  const days = adminDashboardDayWindow(
    alepha.inject(DateTimeProvider).nowMillis(),
    7,
  );
  // Windows as instants: from inclusive, to exclusive (the next day's start).
  const start = (day: string) => `${day}T00:00:00.000Z`;
  const after = (day: string) =>
    new Date(Date.parse(start(day)) + 86_400_000).toISOString();

  const total = async (query: Record<string, string>) =>
    (await client.findProjects({ query: { ...query, size: 1 } })).page
      .totalElements ?? 0;

  return (
    <AdminStatTile
      id={props.id}
      label={tr("admin.projectsTile.title")}
      icon={<FolderKanban className="size-4" />}
      tooltip={tr("admin.projectsTile.tooltip")}
      href="/admin/projects?archived=exclude"
      load={async () => {
        const [value, current, previous] = await Promise.all([
          total({ archived: "exclude" }),
          total({ createdFrom: start(days.from), createdTo: after(days.to) }),
          total({
            createdFrom: start(days.previousFrom),
            createdTo: after(days.previousTo),
          }),
        ]);
        return {
          value,
          delta: { current, previous, label: tr("admin.projectsTile.delta") },
        };
      }}
      note={(loaded) =>
        tr("admin.projectsTile.note", {
          args: [String(loaded.delta?.current ?? 0)],
        })
      }
    />
  );
};
