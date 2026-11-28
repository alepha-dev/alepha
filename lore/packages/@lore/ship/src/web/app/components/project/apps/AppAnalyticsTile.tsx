import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Info, type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

export interface AppAnalyticsTileProps {
  testId: string;
  icon: LucideIcon;
  title: string;
  tooltip?: string;
  /**
   * `null` draws a dash: the number is not counted for this window.
   */
  value: number | null;
  /**
   * The compared window's value, when Compare is on.
   */
  previous?: number | null;
  format: (value: number) => string;
  /**
   * The good direction is down (bounce rate).
   */
  invert?: boolean;
  marker?: ReactNode;
  notes?: string[];
  extra?: ReactNode;
}

/**
 * One headline number, with its delta against the compared window.
 */
const AppAnalyticsTile = (props: AppAnalyticsTileProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = props.icon;
  const { value, previous } = props;
  const delta =
    value !== null &&
    previous !== null &&
    previous !== undefined &&
    previous > 0
      ? Math.round(((value - previous) / previous) * 100)
      : undefined;
  const good = delta !== undefined && (props.invert ? delta <= 0 : delta >= 0);

  return (
    <Card data-testid={props.testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4" />
          {props.title}
          {props.tooltip && (
            <UiTooltip>
              <TooltipTrigger
                render={<Info className="size-3.5 cursor-help opacity-70" />}
              />
              <TooltipContent className="max-w-xs">
                {props.tooltip}
              </TooltipContent>
            </UiTooltip>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            data-testid={`${props.testId}-value`}
            className="text-3xl font-bold tabular-nums"
          >
            {value === null ? "-" : props.format(value)}
          </span>
          {props.marker}
          {delta !== undefined && (
            <UiTooltip>
              <TooltipTrigger
                render={
                  <span
                    data-testid={`${props.testId}-delta`}
                    className={`inline-flex cursor-help items-center gap-1 text-xs font-medium ${
                      good
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  />
                }
              >
                {delta < 0 ? (
                  <TrendingDown className="size-3.5" />
                ) : (
                  <TrendingUp className="size-3.5" />
                )}
                {`${delta > 0 ? "+" : ""}${delta}%`}
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {tr("insights.delta.tooltip")}
              </TooltipContent>
            </UiTooltip>
          )}
        </div>
        {props.notes?.map((note) => (
          <p key={note} className="text-muted-foreground mt-1 text-xs">
            {note}
          </p>
        ))}
        {props.extra}
      </CardContent>
    </Card>
  );
};

export default AppAnalyticsTile;
