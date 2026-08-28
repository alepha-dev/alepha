import type { DevSystem } from "../../../schemas/DevMetadata.ts";

export interface DashboardSystemStripProps {
  system?: DevSystem;
}

/**
 * The facts about the running process, as one strip.
 *
 * Deliberately a single bordered row divided by hairlines rather than six
 * cards: these are readings off one instrument, not six independent things,
 * and gaps between cards imply a separation that isn't there.
 */
export const DashboardSystemStrip = (props: DashboardSystemStripProps) => {
  const system = props.system;

  const cells: Array<{ label: string; value: string; tone?: string }> = [
    {
      label: "Runtime",
      value: system ? (system.runtime === "bun" ? "Bun" : "Node.js") : "…",
    },
    { label: "Node", value: system?.nodeVersion ?? "…" },
    { label: "Alepha", value: system?.alephaVersion ?? "…" },
    { label: "App", value: system?.appVersion ?? "…" },
    {
      label: "Mode",
      value: system ? shorten(system.mode) : "…",
      // Development is the expected state for devtools, so it reads as healthy
      // rather than as a warning.
      tone: system?.mode === "development" ? "var(--dt-get)" : undefined,
    },
    { label: "Port", value: system ? String(system.port) : "…" },
    { label: "Uptime", value: system ? formatUptime(system.uptime) : "…" },
    { label: "Memory", value: system ? formatBytes(system.memoryUsage) : "…" },
  ];

  return (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--dt-border)",
        background: "var(--dt-panel)",
        marginBottom: 22,
      }}
    >
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 14px",
            borderLeft: i === 0 ? undefined : "1px solid var(--dt-border)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--dt-fg-faint)",
            }}
          >
            {cell.label}
          </div>
          <div
            className="dt-mono"
            style={{ fontSize: 14, color: cell.tone ?? "var(--dt-fg)" }}
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
};

const shorten = (mode: string): string =>
  mode === "development" ? "dev" : mode === "production" ? "prod" : mode;

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
};
