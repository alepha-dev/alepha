import type { MonitorIncident } from "../entities/monitorIncidents.ts";
import type { Monitor } from "../entities/monitors.ts";

/**
 * The fields `monitor.down` and `monitor.up` carry (#Q3610), shared by the
 * recorded event and its subject preview.
 *
 * They reach rooms such as Discord, so they are a safe projection: the
 * target loses its query string, fragment and userinfo (a query may carry a
 * token), and the probe error is cut to one short line.
 */
export class UptimeAutomationFields {
  public static readonly ERROR_MAX = 200;

  public build(
    project: { id: number; slug?: string | null; title: string },
    monitor: Monitor,
    incident: MonitorIncident,
    kind: "down" | "up",
  ): Record<string, unknown> {
    const endedAt = kind === "up" ? incident.endedAt : undefined;
    return {
      project: project.title,
      title:
        kind === "down"
          ? `${monitor.name} is down`
          : `${monitor.name} recovered`,
      monitor_id: monitor.id,
      monitor: monitor.name,
      kind: monitor.kind,
      target: this.target(monitor),
      cause: incident.cause,
      error: this.error(incident.lastError),
      started_at: incident.startedAt,
      ...(endedAt
        ? {
            ended_at: endedAt,
            duration_secs: Math.max(
              0,
              Math.round(
                (Date.parse(endedAt) - Date.parse(incident.startedAt)) / 1000,
              ),
            ),
          }
        : {}),
      url: `/${project.slug || `project-${project.id}`}/uptime/${monitor.id}`,
    };
  }

  /**
   * The monitored address without anything that may be a secret: query,
   * fragment and userinfo go. A push monitor has no address.
   */
  public target(monitor: Pick<Monitor, "kind" | "target">): string {
    if (monitor.kind === "push" || !monitor.target) return "Push receipt";
    const raw = monitor.target.trim();
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      // A host:port target (tcp, cert) is not a URL: cut at the first
      // character that could start a query or a fragment.
      return raw.split(/[?#]/)[0].replace(/^[^@/]*@/, "");
    }
  }

  /**
   * The probe error as one short line, or empty.
   */
  public error(error: string | undefined): string {
    const line = (error ?? "").split(/\r?\n/)[0].trim();
    return line.length > UptimeAutomationFields.ERROR_MAX
      ? `${line.slice(0, UptimeAutomationFields.ERROR_MAX - 1)}…`
      : line;
  }
}
