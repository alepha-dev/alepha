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
  protected readonly USE_CASE_PREFIX = "usecase:";

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

  /**
   * The use case of a run error, by its global id, from its fingerprint
   * (`usecase:<useCaseId>:<criterionKey>`). `undefined` for any other error.
   */
  public useCaseId(
    row: Pick<ProjectError, "origin" | "fingerprint">,
  ): number | undefined {
    if (this.of(row) !== "run") return undefined;
    if (!row.fingerprint.startsWith(this.USE_CASE_PREFIX)) return undefined;
    const id = Number(row.fingerprint.split(":")[1]);
    return Number.isInteger(id) && id > 0 ? id : undefined;
  }
}
