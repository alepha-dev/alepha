import { Card, CardContent } from "@alepha/ui/components/ui/card";
import type { LucideIcon } from "lucide-react";

export interface AppErrorsStatProps {
  label: string | number;
  value: number;
  icon?: LucideIcon;
}

/**
 * One window figure on the App ▸ Errors tab.
 *
 * Its own component rather than the Analytics tab's metric row: that one
 * carries period deltas and explanatory tooltips, and this tab has neither to
 * put in. Three numbers with no apparatus is the whole of it.
 */
const AppErrorsStat = (props: AppErrorsStatProps) => {
  const Icon = props.icon;
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        {Icon && <Icon className="text-muted-foreground size-4 shrink-0" />}
        <div className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums">
            {props.value.toLocaleString()}
          </span>
          <span className="text-muted-foreground text-xs">{props.label}</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default AppErrorsStat;
