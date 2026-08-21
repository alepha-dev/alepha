import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { Copy, Crosshair, MoreVertical, Trash2 } from "lucide-react";
import type { I18n } from "../../services/I18n.ts";

export interface DashboardCardMenuProps {
  onChangeScope: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/**
 * The per-card kebab.
 *
 * The mockup lists five entries; three are here. "Update card" and "Change
 * window" are the two the v1 metrics have nothing to configure behind:
 * every filter set is a single default, and the only period the visitors
 * metric accepts is yesterday. An entry that opens a picker with one option
 * is worse than no entry, so they arrive with the metric that needs them.
 *
 * A real dropdown rather than the mockup's hand-rolled absolute panel: it
 * gets focus handling, escape, outside-click and keyboard navigation from
 * the design system instead of from an ad-hoc document listener.
 */
const DashboardCardMenu = (props: DashboardCardMenuProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tr("dashboard.card.options")}
        className="text-muted-foreground/70 hover:bg-accent hover:text-foreground inline-flex size-[22px] shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <MoreVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-46">
        <DropdownMenuItem onClick={props.onChangeScope}>
          <Crosshair className="text-muted-foreground size-3.5" />
          {tr("dashboard.card.scope")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onDuplicate}>
          <Copy className="text-muted-foreground size-3.5" />
          {tr("dashboard.card.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={props.onRemove}>
          <Trash2 className="size-3.5" />
          {tr("dashboard.card.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DashboardCardMenu;
