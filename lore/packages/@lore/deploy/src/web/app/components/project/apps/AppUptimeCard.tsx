import { Button, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorListItem } from "../../../../../api/schemas/monitorListItemSchema.ts";

export interface AppUptimeCardProps {
  /**
   * The HTTP monitor on this instance's address, when there is one.
   */
  monitor?: MonitorListItem;
  /**
   * Where the monitor's own page is.
   */
  href?: string;
  /**
   * Whether an Add monitor action is offered when there is no monitor. False
   * for a reader without `app:manage`, and for an instance with no address.
   */
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
}

/**
 * The app page's view of uptime: this instance's monitor, or the one action
 * that creates it (#Q2680).
 */
const AppUptimeCard = (props: AppUptimeCardProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const monitor = props.monitor;

  if (!monitor && !props.canAdd) {
    return null;
  }

  const status =
    monitor?.status === "up" && monitor.lastResult === "latency"
      ? "latency"
      : monitor?.status;

  return (
    <Card data-testid="app-uptime">
      <CardHeader>
        <CardTitle className="text-base">{tr("uptime.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {monitor ? (
          <>
            <div className="min-w-0">
              <div className="font-medium">
                {props.href ? (
                  <a className="hover:underline" href={props.href}>
                    {monitor.name}
                  </a>
                ) : (
                  monitor.name
                )}
              </div>
              <div className="text-muted-foreground text-xs">
                {tr("uptime.uptime")}:{" "}
                {monitor.uptimePct === null
                  ? tr("uptime.notMeasured")
                  : l(monitor.uptimePct / 100, {
                      number: { style: "percent", maximumFractionDigits: 2 },
                    })}
              </div>
            </div>
            <span className="bg-muted rounded-full px-2 py-1 text-xs font-medium">
              {tr(`uptime.status.${status}` as never)}
            </span>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">{tr("uptime.app.none")}</p>
            <Button size="sm" disabled={props.busy} onClick={props.onAdd}>
              {tr("uptime.createTitle")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AppUptimeCard;
