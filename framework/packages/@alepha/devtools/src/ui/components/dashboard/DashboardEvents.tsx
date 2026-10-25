import type { LogEntry } from "../../hooks/useLogTail.ts";
import { detectEventType } from "../logs/DevLogs.tsx";

export interface DashboardEventsProps {
  entries: LogEntry[];
}

const TYPE_COLOR: Record<string, string> = {
  http: "var(--dt-get)",
  db: "var(--dt-info)",
};

/**
 * The subset of the log tail that is an *event* rather than a message: HTTP
 * requests and database queries. These are what you watch while poking the app,
 * so they get their own panel instead of being buried in the log stream.
 */
export const DashboardEvents = (props: DashboardEventsProps) => {
  const events = props.entries
    .map((entry) => ({ entry, kind: detectEventType(entry.data) }))
    .filter((row): row is { entry: LogEntry; kind: string } => !!row.kind)
    .slice(0, 8);

  return (
    <div className="dt-panel-box">
      <div className="dt-panel-head">
        Recent events
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 9,
            color: "var(--dt-fg-faint)",
          }}
        >
          <span className="dt-live-dot" />
          live
        </span>
      </div>
      <div style={{ padding: "8px 0", minHeight: 180 }}>
        {events.length === 0 ? (
          <div
            style={{
              padding: "0 12px",
              fontSize: 11,
              color: "var(--dt-fg-faint)",
            }}
          >
            No HTTP or database activity yet.
          </div>
        ) : (
          events.map(({ entry, kind }, i) => (
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
              <span style={{ color: "var(--dt-fg-faint)", flex: "none" }}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                style={{
                  color: TYPE_COLOR[kind],
                  flex: "none",
                  width: 26,
                  fontSize: 9,
                }}
              >
                {kind.toUpperCase()}
              </span>
              <span
                style={{
                  color: "var(--dt-fg-dim)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
