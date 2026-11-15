import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@alepha/ui";
import { PALETTE_COLORS, type PaletteColor } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useAction, useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Check, Settings2 } from "lucide-react";

import type { AreaController } from "../../../../../api/controllers/AreaController.ts";
import type { AreaResource } from "../../../../../api/schemas/areaResourceSchema.ts";
import { currentAreasAtom } from "../../../atoms/currentAreasAtom.ts";
import { AREA_DOT_CLASS } from "../../shared/areaColor.ts";

export interface QuestGroupMenuProps {
  area: AreaResource;
}

/**
 * What right-clicking an area in the quest log offers: its colour, the same
 * swatch grid the board's column menu draws, and a way to the area's
 * settings page.
 *
 * The colour is written through `updateArea`, then patched into
 * `currentAreasAtom`, which every area dot in the project reads (the log,
 * the board's cards and lanes), so the new colour shows everywhere at once
 * without a reload. Offered only to a rank with `area:manage`, the action's
 * own permission.
 */
const QuestGroupMenu = (props: QuestGroupMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const router = useRouter();
  const areaApi = useClient<AreaController>();
  const canColor = areaApi.updateArea.can();

  const setColor = useAction<[color: PaletteColor], void>(
    {
      handler: async (_context, color) => {
        const updated = await areaApi.updateArea({
          params: { id: props.area.id },
          body: { color },
        });
        const areas = alepha.store.get(currentAreasAtom) ?? [];
        alepha.store.set(
          currentAreasAtom,
          areas.map((area) =>
            area.id === updated.id ? { ...area, color: updated.color } : area,
          ),
        );
      },
    },
    [areaApi, props.area.id],
  );

  return (
    <ContextMenuContent data-testid="quest-log-area-menu">
      {canColor && (
        <>
          {/* A plain heading and a grid of buttons rather than menu items:
              a swatch sets a value, it is not a command. */}
          <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
            {tr("quest-log.area.color")}
          </div>
          <div className="grid grid-cols-4 gap-1 px-2 pb-1">
            {PALETTE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-testid={`quest-log-area-color-${color}`}
                aria-label={color}
                aria-pressed={props.area.color === color}
                disabled={setColor.loading}
                onClick={() => void setColor.run(color)}
                className="hover:bg-hover flex size-7 items-center justify-center rounded disabled:opacity-50"
              >
                <span
                  className={`flex size-4 items-center justify-center rounded-full ${AREA_DOT_CLASS[color]}`}
                >
                  {props.area.color === color && (
                    <Check className="size-3 text-white" />
                  )}
                </span>
              </button>
            ))}
          </div>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        data-testid="quest-log-area-settings"
        onClick={() =>
          router.push("projectSettingsArea", {
            params: {
              projectSlug: router.state.params.projectSlug,
              areaId: String(props.area.id),
            },
          })
        }
      >
        <Settings2 className="size-4" />
        {tr("quest-log.area.settings")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
};

export default QuestGroupMenu;
