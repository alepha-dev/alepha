import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";

export interface AdminDashboardTilePickerProps {
  items: AdminDashboardTilePickerItem[];
  onAdd: (id: string) => void;
  disabled?: boolean;
}

/**
 * Customize mode's "Add a tile" list: every catalog tile not in the grid,
 * with its title and description.
 *
 * A tile this admin cannot see (its `can()` is false) is listed too, marked
 * unavailable rather than hidden: the layout is shared, and one admin's
 * missing permission must never drop another admin's tile from it.
 */
export const AdminDashboardTilePicker = (
  props: AdminDashboardTilePickerProps,
) => {
  const { tr } = useI18n();

  return (
    <section className="flex flex-col gap-2" data-slot="dashboard-tile-picker">
      <h2 className="text-sm font-medium">
        {tr("admin.dashboard.addTile", { default: "Add a tile" })}
      </h2>
      {props.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("admin.dashboard.allTilesShown", {
            default: "Every tile is on the dashboard.",
          })}
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {props.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 px-3 py-2"
              data-tile-id={item.id}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{item.title}</span>
                {item.description ? (
                  <span className="text-muted-foreground text-xs">
                    {item.description}
                  </span>
                ) : null}
              </div>
              {item.unavailable ? (
                <Badge
                  variant="tint"
                  tone="neutral"
                  title={tr("admin.dashboard.unavailableTileHint", {
                    default:
                      "Its module is not available to you. It stays in the layout as it is.",
                  })}
                >
                  {tr("admin.dashboard.unavailableTile", {
                    default: "Unavailable",
                  })}
                </Badge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outlined"
                  disabled={props.disabled}
                  aria-label={tr("admin.dashboard.addNamedTile", {
                    default: "Add $1",
                    args: [item.title],
                  })}
                  onClick={() => props.onAdd(item.id)}
                >
                  <Plus className="size-4" />
                  {tr("admin.dashboard.add", { default: "Add" })}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export interface AdminDashboardTilePickerItem {
  id: string;
  title: string;
  description?: string;
  /**
   * The tile's module is not offered to this admin: it is listed so they
   * know it exists, kept in the layout as it is, and cannot be added here.
   */
  unavailable: boolean;
}
