import type { LogEntry } from "../../hooks/useLogTail.ts";
import { LEVEL_COLOR, shortModule } from "./logFormat.ts";

export interface LogToolbarFilters {
  level?: string;
  type?: string;
  module?: string;
  q?: string;
  slow?: string;
}

export interface LogToolbarProps {
  filters: LogToolbarFilters;
  entries: LogEntry[];
  onChange: (next: LogToolbarFilters) => void;
}

const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];

/**
 * Named views over the same three filters. Each is a question a developer
 * actually asks — "what broke", "what did the client call", "what hit the
 * database", "what is slow" — spelled as one click instead of three.
 */
const PRESETS: Array<{ label: string; value: LogToolbarFilters }> = [
  { label: "All", value: { level: "DEBUG" } },
  { label: "Errors", value: { level: "ERROR" } },
  { label: "HTTP", value: { level: "TRACE", type: "http" } },
  { label: "DB", value: { level: "TRACE", type: "db" } },
  { label: "Slow", value: { level: "TRACE", slow: "200" } },
];

export const LogToolbar = (props: LogToolbarProps) => {
  const f = props.filters;
  const level = f.level ?? "DEBUG";

  /**
   * Counts come from the entries on screen, which are already filtered — so
   * they answer "how much of what I am looking at is this", not "how much
   * exists". That is the useful reading while narrowing down.
   */
  const levelCounts = new Map<string, number>();
  const moduleCounts = new Map<string, number>();
  for (const entry of props.entries) {
    levelCounts.set(entry.level, (levelCounts.get(entry.level) ?? 0) + 1);
    if (entry.module) {
      moduleCounts.set(entry.module, (moduleCounts.get(entry.module) ?? 0) + 1);
    }
  }

  const modules = [...moduleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const matchesPreset = (preset: LogToolbarFilters): boolean =>
    (preset.level ?? "DEBUG") === level &&
    (preset.type ?? "") === (f.type ?? "") &&
    (preset.slow ?? "") === (f.slow ?? "");

  /**
   * The threshold is a floor, so every level at or above it is included. The
   * group shows that directly — lit means "you are seeing these" — rather than
   * highlighting only the one level whose name matches the parameter.
   */
  const included = (lvl: string): boolean =>
    LEVELS.indexOf(lvl) >= LEVELS.indexOf(level);

  const queryEcho = [
    `?level=${LEVELS.slice(LEVELS.indexOf(level)).join(",").toLowerCase()}`,
    f.type ? `&type=${f.type}` : "",
    f.module ? `&module=${f.module}` : "",
    f.slow ? `&slowerThan=${f.slow}` : "",
  ].join("");

  return (
    <>
      <div className="dt-toolbar">
        <span className="dt-seg">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="dt-seg-item"
              data-on={matchesPreset(preset.value) || undefined}
              onClick={() =>
                props.onChange({
                  ...preset.value,
                  module: f.module,
                  q: f.q,
                })
              }
            >
              {preset.label}
            </button>
          ))}
        </span>

        <span className="dt-seg">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              className="dt-seg-item"
              data-on={included(lvl) || undefined}
              style={{ color: included(lvl) ? LEVEL_COLOR[lvl] : undefined }}
              onClick={() => props.onChange({ ...f, level: lvl })}
              title={`Show ${lvl} and above`}
            >
              {lvl}
              <span className="dt-seg-count">{levelCounts.get(lvl) ?? 0}</span>
            </button>
          ))}
        </span>

        <span style={{ marginLeft: "auto" }} />
        <span
          className="dt-mono"
          style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
          title="These filters as a query string"
        >
          {queryEcho}
        </span>
      </div>

      <div className="dt-toolbar" style={{ background: "transparent" }}>
        <input
          className="dt-input"
          style={{ width: 240 }}
          placeholder="message, path, sql…"
          value={f.q ?? ""}
          onChange={(e) =>
            props.onChange({ ...f, q: e.currentTarget.value || undefined })
          }
        />

        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--dt-fg-faint)",
          }}
        >
          Module
        </span>

        {modules.map(([name, count]) => (
          <button
            key={name}
            type="button"
            className="dt-btn"
            data-on={f.module === name || undefined}
            onClick={() =>
              props.onChange({
                ...f,
                module: f.module === name ? undefined : name,
              })
            }
            title={name}
          >
            {shortModule(name)}
            <span className="dt-seg-count">{count}</span>
          </button>
        ))}
      </div>
    </>
  );
};
