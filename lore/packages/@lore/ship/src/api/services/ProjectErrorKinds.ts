import type { ProjectError } from "../entities/projectErrors.ts";
import type { ProjectErrorKind } from "../schemas/projectErrorKindSchema.ts";

/**
 * The kind of an error row, read from what its writer left on it (#E185):
 * `RunErrorService` writes `origin: "run"`, `UptimeErrorService` a
 * fingerprint `uptime:<projectId>:<monitorId>`, and everything else came
 * through the sigil ingest.
 */
export class ProjectErrorKinds {
  protected readonly UPTIME_PREFIX = "uptime:";

  public of(
    row: Pick<ProjectError, "origin" | "fingerprint">,
  ): ProjectErrorKind {
    if (row.origin === "run") return "run";
    if (row.fingerprint.startsWith(this.UPTIME_PREFIX)) return "uptime";
    return "sigil";
  }

  /**
   * The monitor of an uptime error, from its fingerprint. `undefined` for
   * any other error, and for a fingerprint that names none.
   */
  public monitorId(
    row: Pick<ProjectError, "origin" | "fingerprint">,
  ): string | undefined {
    if (this.of(row) !== "uptime") return undefined;
    const id = row.fingerprint.split(":")[2];
    return id || undefined;
  }
}
