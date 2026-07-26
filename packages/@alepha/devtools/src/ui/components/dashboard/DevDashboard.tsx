import { useRouter } from "alepha/react/router";
import {
  Archive,
  Atom,
  Boxes,
  Clock,
  Cpu,
  HardDrive,
  Radio,
  ShieldCheck,
  Table2,
  Timer,
  Variable,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useMemo } from "react";
import { useLogTail } from "../../hooks/useLogTail.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { detectEventType } from "../logs/DevLogs.tsx";
import { DevError } from "../shared/DevError.tsx";

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface PrimitiveCard {
  label: string;
  count: number;
  icon: ComponentType<{ size?: number }>;
  href: string;
}

export const DevDashboard = () => {
  const meta = useMetadata();
  const router = useRouter();
  const tail = useLogTail({
    level: "DEBUG",
    type: "",
    module: "",
    search: "",
  });

  const d = meta.data;
  const system = d?.system;

  /**
   * Every card links somewhere. They were previously inert, which made the
   * dashboard a place you looked at rather than a place you moved through.
   */
  const cards = useMemo<PrimitiveCard[]>(() => {
    if (!d) return [];
    return [
      {
        label: "Actions",
        count: d.actions?.length ?? 0,
        icon: Zap,
        href: "/actions",
      },
      {
        label: "Pages",
        count: d.pages?.length ?? 0,
        icon: Archive,
        href: "/pages",
      },
      {
        label: "Jobs",
        count: d.jobs?.length ?? 0,
        icon: Clock,
        href: "/jobs",
      },
      {
        label: "Topics",
        count: d.topics?.length ?? 0,
        icon: Radio,
        href: "/topics",
      },
      {
        label: "Caches",
        count: d.caches?.length ?? 0,
        icon: Boxes,
        href: "/caches",
      },
      {
        label: "Storages",
        count: d.storages?.length ?? 0,
        icon: HardDrive,
        href: "/storages",
      },
      {
        label: "Realms",
        count: d.realms?.length ?? 0,
        icon: ShieldCheck,
        href: "/realms",
      },
      {
        label: "Entities",
        count: d.entities?.length ?? 0,
        icon: Table2,
        href: "/schema",
      },
      {
        label: "Atoms",
        count: d.atoms?.length ?? 0,
        icon: Atom,
        href: "/state",
      },
    ].filter((c) => c.count > 0);
  }, [d]);

  const errorCount = useMemo(
    () => tail.entries.filter((e) => e.level === "ERROR").length,
    [tail.entries],
  );

  if (meta.error) {
    return (
      <DevError what="metadata" message={meta.error} onRetry={meta.reload} />
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
      <div className="dt-section-label" style={{ margin: "0 -14px 12px" }}>
        System
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <Stat
          label="Runtime"
          value={system ? `${system.runtime} ${system.nodeVersion}` : "…"}
          icon={Cpu}
        />
        <Stat label="Mode" value={system?.mode ?? "…"} icon={Zap} />
        <Stat
          label="Port"
          value={system ? String(system.port) : "…"}
          icon={Variable}
        />
        <Stat
          label="Uptime"
          value={system ? formatUptime(system.uptime) : "…"}
          icon={Timer}
        />
        <Stat
          label="Memory"
          value={system ? formatBytes(system.memoryUsage) : "…"}
          icon={Cpu}
        />
        <Stat
          label="Errors (buffer)"
          value={String(errorCount)}
          icon={Zap}
          tone={errorCount > 0 ? "var(--dt-error)" : undefined}
        />
      </div>

      <div className="dt-section-label" style={{ margin: "0 -14px 12px" }}>
        Primitives
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
          marginBottom: 24,
        }}
      >
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            className="dt-btn"
            style={{
              height: "auto",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "flex-start",
            }}
            onClick={() => router.push(c.href)}
          >
            <c.icon size={14} />
            <span style={{ textAlign: "left" }}>
              <span
                style={{
                  display: "block",
                  fontSize: 10,
                  color: "var(--dt-fg-faint)",
                }}
              >
                {c.label}
              </span>
              <span
                className="dt-mono"
                style={{ display: "block", fontSize: 16 }}
              >
                {c.count}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div
        className="dt-section-label"
        style={{ margin: "0 -14px 0", display: "flex" }}
      >
        Recent activity
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <span className="dt-live-dot" />
        </span>
      </div>
      <table className="dt-table">
        <tbody>
          {tail.entries.slice(0, 25).map((e, i) => {
            const kind = detectEventType(e.data);
            return (
              <tr
                key={`${e.timestamp}-${i}`}
                className="dt-row-click"
                onClick={() => router.push("/logs")}
              >
                <td style={{ width: 90 }}>
                  {new Date(e.timestamp).toLocaleTimeString()}
                </td>
                <td
                  style={{
                    width: 60,
                    color: e.level === "ERROR" ? "var(--dt-error)" : undefined,
                  }}
                >
                  {e.level}
                </td>
                <td style={{ width: 50 }}>{kind ? kind.toUpperCase() : ""}</td>
                <td style={{ width: 130 }}>{e.module}</td>
                <td style={{ maxWidth: "none" }}>{e.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

interface StatProps {
  label: string;
  value: string;
  icon: ComponentType<{ size?: number }>;
  tone?: string;
}

const Stat = (props: StatProps) => (
  <div
    style={{
      border: "1px solid var(--dt-border)",
      background: "var(--dt-panel)",
      padding: "8px 10px",
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}
  >
    <props.icon size={13} />
    <span>
      <span
        style={{
          display: "block",
          fontSize: 9,
          color: "var(--dt-fg-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        {props.label}
      </span>
      <span
        className="dt-mono"
        style={{ display: "block", fontSize: 12, color: props.tone }}
      >
        {props.value}
      </span>
    </span>
  </div>
);

export default DevDashboard;
