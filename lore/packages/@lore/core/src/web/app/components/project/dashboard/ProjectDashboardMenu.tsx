import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { LayoutTemplate, MoreHorizontal, RotateCcw } from "lucide-react";

import {
  type DashboardPreset,
  DashboardPresetCatalog,
} from "../../../../../api/schemas/DashboardPresetCatalog.ts";
import type { DashboardPresetKey } from "../../../../../api/schemas/dashboardPresetKeySchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import {
  capabilityOption,
  hasCapability,
} from "../../../services/projectCapabilities.ts";

export interface ProjectDashboardMenuProps {
  /**
   * "Reset to default". Absent where there is nothing to reset to: a board
   * still computed, or a dashboard that is not the first.
   */
  onReset?: () => void;
  /**
   * Apply a preset to the board on screen (#Q3831).
   */
  onApplyPreset: (preset: DashboardPreset) => void;
  /**
   * Start a new dashboard from a preset (#Q3831).
   */
  onCreateFromPreset: (preset: DashboardPreset) => void;
  /**
   * True while a board write runs: the menu's writes wait for it (#E59 rule 10).
   */
  busy?: boolean;
}

/**
 * The board's own menu, for `project:update`: the presets (#Q3831), applied
 * to this board or starting a new one, and "Reset to default" on a
 * customized first board, which deletes the stored cards and puts every
 * member back on the computed board (#Q2660).
 *
 * A preset the project cannot use (its capability or option is off) is
 * listed disabled, saying what to turn on, rather than hidden: the reader
 * learns it exists.
 */
const ProjectDashboardMenu = (props: ProjectDashboardMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const usable = (preset: DashboardPreset) =>
    preset.needs.option
      ? capabilityOption(project, preset.needs.capability, preset.needs.option)
      : hasCapability(project, preset.needs.capability);

  const presetItems = (
    onPick: (preset: DashboardPreset) => void,
    testId: string,
  ) =>
    DashboardPresetCatalog.PRESETS.map((preset) => {
      const ok = usable(preset);
      return (
        <DropdownMenuItem
          key={preset.key}
          disabled={!ok || props.busy}
          data-testid={`${testId}-${preset.key satisfies DashboardPresetKey}`}
          onClick={() => onPick(preset)}
          className="flex-col items-start gap-0.5"
        >
          <span>{tr(preset.labelKey as never)}</span>
          <span className="text-muted-foreground text-xs">
            {tr((ok ? preset.descriptionKey : preset.needsKey) as never)}
          </span>
        </DropdownMenuItem>
      );
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tr("dashboard.menu")}
        data-testid="dashboard-menu"
        className="text-muted-foreground hover:bg-hover hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="dashboard-presets">
            <LayoutTemplate className="size-3.5" />
            {tr("dashboard.presets")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {tr("dashboard.presets.apply")}
              </DropdownMenuLabel>
              {presetItems(props.onApplyPreset, "dashboard-preset")}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {tr("dashboard.presets.newFrom")}
              </DropdownMenuLabel>
              {presetItems(props.onCreateFromPreset, "dashboard-preset-new")}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {props.onReset && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={props.busy}
              data-testid="dashboard-reset"
              onClick={props.onReset}
            >
              <RotateCcw className="size-3.5" />
              {tr("dashboard.reset")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProjectDashboardMenu;
