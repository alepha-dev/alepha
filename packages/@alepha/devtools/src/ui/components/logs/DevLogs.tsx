import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { Pause, Play, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { DEV_LOG_RESTART_TYPE } from "../../../schemas/DevLogMarker.ts";
import { type LogEntry, useLogTail } from "../../hooks/useLogTail.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { LogDetail } from "./LogDetail.tsx";
import {
  LEVEL_COLOR,
  MESSAGE_COLOR,
  shortContext,
  shortModule,
} from "./logFormat.ts";
import { LogToolbar } from "./LogToolbar.tsx";

/**
 * Filters live in the query string so a narrowed view survives a reload and
 * can be handed to someone else verbatim.
 */
const querySchema = z.object({
  level: z.text().optional(),
  type: z.text().optional(),
  module: z.text().optional(),
  q: z.text().optional(),
  slow: z.text().optional(),
});

export const detectEventType = (data: any): string | undefined => {
  if (!data || typeof data !== "object") return undefined;
  // `duration` can round to 0 and still be an HTTP entry.
  if (
    data.status &&
    data.method &&
    data.path &&
    typeof data.duration === "number"
  )
    return "http";
  if (data.type === "db:query") return "db";
  return undefined;
};

/**
 * The synthetic entry devtools writes when it restores a previous run's logs.
 *
 * Read off the structure, never the message, so an application that happens to
 * log the same words cannot draw a divider through its own output.
 */
const isRestartMarker = (entry: LogEntry): boolean =>
  entry.data?.type === DEV_LOG_RESTART_TYPE;

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

export const DevLogs = () => {
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [selected, setSelected] = useState<LogEntry | null>(null);

  const filters = useMemo(
    () => ({
      level: params.level ?? "DEBUG",
      type: params.type ?? "",
      module: params.module ?? "",
      search: params.q ?? "",
      slowerThan: params.slow ?? "",
    }),
    [params],
  );

  const tail = useLogTail(filters);

  if (tail.error && tail.entries.length === 0) {
    return <DevError what="logs" message={tail.error} onRetry={tail.reload} />;
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
        }}
      >
        <LogToolbar
          filters={params}
          entries={tail.entries}
          onChange={setParams}
        />

        <div className="dt-toolbar" style={{ background: "transparent" }}>
          <button
            type="button"
            className="dt-btn"
            data-on={tail.following || undefined}
            // Green, not the accent: following is a healthy running state, the
            // same thing the live dot beside it means.
            style={tail.following ? { color: "var(--dt-get)" } : undefined}
            onClick={() => tail.setFollowing(!tail.following)}
          >
            {tail.following ? <Pause size={11} /> : <Play size={11} />}
            {tail.following ? "Following" : "Paused"}
          </button>

          {tail.following && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--dt-fg-faint)",
              }}
            >
              <span className="dt-live-dot" />
              live · {tail.ratePerSecond}/s
            </span>
          )}

          {!tail.following && tail.pending > 0 && (
            <button
              type="button"
              className="dt-btn"
              data-variant="primary"
              onClick={tail.flush}
            >
              {tail.pending} new ↓
            </button>
          )}

          <span style={{ marginLeft: "auto" }} />
          {tail.dropped > 0 && (
            /**
             * Only when the buffer itself overflowed. The tail drains a burst
             * across as many requests as it takes, so falling behind is not
             * loss - this is, and it is the one case the reader cannot fix by
             * scrolling.
             */
            <span
              className="dt-mono"
              style={{ fontSize: 10, color: "var(--dt-warn, #d08770)" }}
              title="The log buffer is full and evicted its oldest entries. Raise MemoryDestinationProvider.options.maxEntries to keep more."
            >
              {tail.dropped} dropped
            </span>
          )}
          <span
            className="dt-mono"
            style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
          >
            {tail.entries.length} shown / {tail.total} buffered
          </span>
          <button type="button" className="dt-btn" onClick={tail.clear}>
            <Trash2 size={11} /> Clear
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {tail.entries.length === 0 ? (
            <DevEmpty
              title="No logs match the current filters"
              hint="Widen the level or clear the search"
              action={{
                label: "Reset filters",
                onClick: () => setParams({}),
              }}
            />
          ) : (
            <table className="dt-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Time</th>
                  <th style={{ width: 60 }}>Level</th>
                  <th style={{ width: 50 }}>Type</th>
                  <th style={{ width: 50 }}>Ctx</th>
                  <th style={{ width: 110 }}>Module</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {tail.entries.map((entry, i) => {
                  const kind = detectEventType(entry.data);

                  if (isRestartMarker(entry)) {
                    return (
                      <tr key={`${entry.timestamp}-${i}`}>
                        <td
                          colSpan={6}
                          style={{
                            padding: "10px 14px",
                            color: "var(--dt-fg-faint)",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                height: 1,
                                background: "var(--dt-border)",
                              }}
                            />
                            App restarted · {formatTime(entry.timestamp)}
                            <span
                              style={{
                                flex: 1,
                                height: 1,
                                background: "var(--dt-border)",
                              }}
                            />
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={`${entry.timestamp}-${i}`}
                      className="dt-row-click"
                      data-active={
                        selected?.timestamp === entry.timestamp &&
                        selected?.message === entry.message
                          ? true
                          : undefined
                      }
                      onClick={() =>
                        setSelected(selected === entry ? null : entry)
                      }
                    >
                      <td>{formatTime(entry.timestamp)}</td>
                      <td style={{ color: LEVEL_COLOR[entry.level] }}>
                        {entry.level}
                      </td>
                      <td
                        style={{
                          color:
                            kind === "http"
                              ? "var(--dt-get)"
                              : "var(--dt-post)",
                        }}
                      >
                        {kind ? kind.toUpperCase() : ""}
                      </td>
                      <td title={entry.context}>
                        {shortContext(entry.context)}
                      </td>
                      <td title={entry.module}>{shortModule(entry.module)}</td>
                      {/*
                       * The message carries the level's colour too. Scanning a
                       * thousand rows, the eye lands on the message column —
                       * a coloured 40px LEVEL cell on the far left is easy to
                       * miss.
                       */}
                      <td
                        style={{
                          color: MESSAGE_COLOR[entry.level],
                          maxWidth: "none",
                        }}
                      >
                        {entry.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div
          style={{
            width: 420,
            flex: "none",
            borderLeft: "1px solid var(--dt-border)",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid var(--dt-border)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--dt-fg-faint)" }}>
              Log detail
            </span>
            <button
              type="button"
              className="dt-btn"
              style={{ marginLeft: "auto", padding: "0 6px" }}
              onClick={() => setSelected(null)}
            >
              <X size={11} />
            </button>
          </div>
          <LogDetail entry={selected} />
        </div>
      )}
    </div>
  );
};

export default DevLogs;
