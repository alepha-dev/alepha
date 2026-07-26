import { ArrowRight } from "lucide-react";
import type { LogEntry } from "../../hooks/useLogTail.ts";
import { LEVEL_COLOR, MESSAGE_COLOR, shortModule } from "../logs/logFormat.ts";

export interface DashboardLogsProps {
  entries: LogEntry[];
  onViewAll: () => void;
}

/**
 * A short peek at the log stream, with a way through to the full screen.
 *
 * Eight lines, not twenty-five: the dashboard's job is to tell you whether
 * something is wrong, and a page-filling log table answers that no better than
 * a glance while crowding out everything else.
 */
export const DashboardLogs = (props: DashboardLogsProps) => (
  <div className="dt-panel-box">
    <div className="dt-panel-head">
      Recent logs
      <button
        type="button"
        onClick={props.onViewAll}
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          border: 0,
          background: "transparent",
          color: "var(--dt-accent)",
          font: "inherit",
          fontSize: 10,
          textTransform: "none",
          letterSpacing: 0,
          cursor: "pointer",
        }}
      >
        View all <ArrowRight size={10} />
      </button>
    </div>
    <div style={{ padding: "8px 0", minHeight: 180 }}>
      {props.entries.slice(0, 8).map((entry, i) => (
        <div
          key={`${entry.timestamp}-${i}`}
          className="dt-mono"
          style={{
            display: "flex",
            gap: 12,
            padding: "2px 12px",
            fontSize: 11,
          }}
        >
          <span
            style={{
              color: LEVEL_COLOR[entry.level] ?? "var(--dt-fg-dim)",
              flex: "none",
              width: 42,
              fontSize: 9,
            }}
          >
            {entry.level}
          </span>
          <span
            style={{ color: "var(--dt-fg-faint)", flex: "none", width: 96 }}
          >
            {shortModule(entry.module)}
          </span>
          <span
            style={{
              color: MESSAGE_COLOR[entry.level] ?? "var(--dt-fg-dim)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.message}
          </span>
        </div>
      ))}
    </div>
  </div>
);
