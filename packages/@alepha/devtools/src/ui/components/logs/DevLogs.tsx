import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { Pause, Play, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { type LogEntry, useLogTail } from "../../hooks/useLogTail.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { LogDetail } from "./LogDetail.tsx";

const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];

const LEVEL_COLOR: Record<string, string> = {
  TRACE: "var(--dt-trace)",
  DEBUG: "var(--dt-debug)",
  INFO: "var(--dt-info)",
  WARN: "var(--dt-warn)",
  ERROR: "var(--dt-error)",
};

const TYPES = [
  { value: "", label: "All" },
  { value: "http", label: "HTTP" },
  { value: "db", label: "DB" },
];

/**
 * Filters live in the query string so a narrowed view survives a reload and
 * can be handed to someone else verbatim.
 */
const querySchema = z.object({
  level: z.text().optional(),
  type: z.text().optional(),
  module: z.text().optional(),
  q: z.text().optional(),
});

export const detectEventType = (data: any): string | undefined => {
  if (!data || typeof data !== "object") return undefined;
  if (data.status && data.method && data.path && data.duration) return "http";
  if (data.type === "db:query") return "db";
  return undefined;
};

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
    }),
    [params],
  );

  const tail = useLogTail(filters);

  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const e of tail.entries) if (e.module) set.add(e.module);
    return Array.from(set).sort();
  }, [tail.entries]);

  const patch = (next: Partial<typeof params>) =>
    setParams({ ...params, ...next });

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
        <div className="dt-toolbar">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              className="dt-btn"
              data-on={filters.level === lvl || undefined}
              style={{ color: LEVEL_COLOR[lvl] }}
              onClick={() => patch({ level: lvl })}
            >
              {lvl}
            </button>
          ))}

          <span
            style={{ width: 1, height: 18, background: "var(--dt-border)" }}
          />

          {TYPES.map((t) => (
            <button
              key={t.value || "all"}
              type="button"
              className="dt-btn"
              data-on={filters.type === t.value || undefined}
              onClick={() => patch({ type: t.value || undefined })}
            >
              {t.label}
            </button>
          ))}

          <select
            className="dt-input"
            style={{ width: 150 }}
            value={filters.module}
            onChange={(e) =>
              patch({ module: e.currentTarget.value || undefined })
            }
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <input
            className="dt-input"
            style={{ width: 200 }}
            placeholder="Search message, path…"
            value={filters.search}
            onChange={(e) => patch({ q: e.currentTarget.value || undefined })}
          />
        </div>

        <div className="dt-toolbar" style={{ background: "transparent" }}>
          <button
            type="button"
            className="dt-btn"
            data-on={tail.following || undefined}
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
              data-on="true"
              onClick={tail.flush}
            >
              {tail.pending} new ↓
            </button>
          )}

          <span style={{ marginLeft: "auto" }} />
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
                  <th style={{ width: 70 }}>Ctx</th>
                  <th style={{ width: 130 }}>Module</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {tail.entries.map((entry, i) => {
                  const kind = detectEventType(entry.data);
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
                      <td>{entry.context ?? ""}</td>
                      <td>{entry.module}</td>
                      <td
                        style={{
                          color:
                            entry.level === "ERROR"
                              ? "var(--dt-error)"
                              : undefined,
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
