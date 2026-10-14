import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { MoreHorizontal, RotateCcw } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";

export interface ProjectDashboardMenuProps {
  onReset: () => void;
  /**
   * True while a board write runs: the reset waits for it (#E59 rule 10).
   */
  busy?: boolean;
}

/**
 * The board's own menu, on a customized board, for `project:update`: "Reset
 * to default", which deletes the stored cards and puts every member back on
 * the computed board (#Q2660).
 */
const ProjectDashboardMenu = (props: ProjectDashboardMenuProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tr("dashboard.menu")}
        data-testid="dashboard-menu"
        className="text-muted-foreground hover:bg-hover hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem
          variant="destructive"
          disabled={props.busy}
          data-testid="dashboard-reset"
          onClick={props.onReset}
        >
          <RotateCcw className="size-3.5" />
          {tr("dashboard.reset")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProjectDashboardMenu;
