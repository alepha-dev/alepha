import { Button } from "@alepha/ui";
import { type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorListItem } from "../../../../../api/schemas/monitorListItemSchema.ts";
import MonitorBeatBar from "./MonitorBeatBar.tsx";

export interface MonitorListRowProps {
  monitor: MonitorListItem;
  canManage: boolean;
  busy: boolean;
  onEdit: (monitor: MonitorListItem) => void;
  onToggle: (monitor: MonitorListItem) => void;
  onDelete: (monitor: MonitorListItem) => void;
  onRotate: (monitor: MonitorListItem) => void;
}
const MonitorListRow = (props: MonitorListRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const monitor = props.monitor;
  const status =
    monitor.status === "up" && monitor.lastResult === "latency"
      ? "latency"
      : monitor.status;
  const tone =
    status === "down"
      ? "bg-red-500/10 text-red-700 dark:text-red-300"
      : status === "up"
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : status === "latency"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-muted text-muted-foreground";
  return (
    <li className="grid grid-cols-2 items-center gap-3 border-b p-3 last:border-b-0 xl:grid-cols-[minmax(150px,1.4fr)_85px_85px_85px_minmax(100px,1fr)_auto]">
      <div className="col-span-2 min-w-0 xl:col-span-1">
        <div className="font-medium">{monitor.name}</div>
        <div
          className="text-muted-foreground truncate text-xs"
          title={monitor.target}
        >
          {tr(`uptime.kind.${monitor.kind}` as never)}
          {monitor.target ? `: ${monitor.target}` : ""}
        </div>
      </div>
      <span
        className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${tone}`}
      >
        {tr(`uptime.status.${status}` as never)}
      </span>
      <div>
        <div className="text-muted-foreground text-xs">
          {tr("uptime.uptime")}
        </div>
        <div className="text-sm tabular-nums">
          {monitor.uptimePct === null
            ? tr("uptime.notMeasured")
            : l(monitor.uptimePct / 100, {
                number: { style: "percent", maximumFractionDigits: 2 },
              })}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground text-xs">
          {tr("uptime.lastLatency")}
        </div>
        <div className="text-sm tabular-nums">
          {monitor.lastLatencyMs === undefined
            ? tr("uptime.notMeasured")
            : tr("uptime.latencyValue", { args: [l(monitor.lastLatencyMs)] })}
        </div>
      </div>
      <MonitorBeatBar beats={monitor.beats} />
      {props.canManage && (
        <div className="col-span-2 flex flex-wrap justify-end gap-1 xl:col-span-1">
          <Button
            size="sm"
            variant="minimal"
            disabled={props.busy}
            onClick={() => props.onEdit(monitor)}
          >
            {tr("uptime.edit")}
          </Button>
          <Button
            size="sm"
            variant="minimal"
            disabled={props.busy}
            onClick={() => props.onToggle(monitor)}
          >
            {tr(monitor.active ? "uptime.pause" : "uptime.resume")}
          </Button>
          {monitor.kind === "push" && (
            <Button
              size="sm"
              variant="minimal"
              disabled={props.busy}
              onClick={() => props.onRotate(monitor)}
            >
              {tr("uptime.rotate")}
            </Button>
          )}
          <Button
            size="sm"
            variant="minimal"
            disabled={props.busy}
            onClick={() => props.onDelete(monitor)}
          >
            {tr("uptime.delete")}
          </Button>
        </div>
      )}
    </li>
  );
};
export default MonitorListRow;
