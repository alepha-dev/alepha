/**
 * Target validation shared by the form and the write API.
 */
export class MonitorTarget {
  public error(kind: string, target: string): string | undefined {
    if (kind === "push") return undefined;
    try {
      const url = new URL(
        kind === "http" ? target.trim() : `tcp://${target.trim()}`,
      );
      if (url.username || url.password)
        return "Put credentials outside the monitor target";
      if (!url.hostname) return "A target host is required";
      if (kind === "http") {
        if (!["http:", "https:"].includes(url.protocol))
          return "Use an http or https URL";
      } else {
        if (url.pathname || url.search || url.hash)
          return "Use a host and port, without a path";
        const port = url.port ? Number(url.port) : kind === "cert" ? 443 : 0;
        if (!port || port > 65535) return "Use a port between 1 and 65535";
      }
    } catch {
      return kind === "http"
        ? "Use a valid http or https URL"
        : "Use a valid host:port target";
    }
    return undefined;
  }
}
