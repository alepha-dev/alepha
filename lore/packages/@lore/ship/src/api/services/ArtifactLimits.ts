import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * How much one project may keep in its artifact registry (#Q4542).
 *
 * Until these, nothing bounded growth: a project could push any number of
 * builds and store any total, and the one cap there was, the archive's size,
 * was a static `z.file({ maxBytes })` that only a redeploy could move.
 *
 * Three caps, read by `ArtifactService` on every push:
 *
 * - **rows per project**, archives and images together, checked only when a
 *   push would add a row: a re-push, a `latest` replace and a `--force` add
 *   none;
 * - **one archive's size**, under a platform ceiling the push schema keeps;
 * - **the archives' total**, the sum of `artifacts.size` over the project's
 *   archives. Images store no bytes in Lore and do not count toward it.
 */
export class ArtifactLimits {
  /**
   * Rows per project when nothing says otherwise: a hundred is months of
   * pinned releases for a project with a few apps, `latest` costing one row
   * per app and runtime however often it moves.
   */
  public static readonly DEFAULT_MAX_ARTIFACTS = 100;

  /**
   * One archive's size when nothing says otherwise. Lore's own build, the
   * largest pushed, is a few megabytes.
   */
  public static readonly DEFAULT_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

  /**
   * The archives' total per project when nothing says otherwise.
   */
  public static readonly DEFAULT_MAX_BYTES_PER_PROJECT = 1000 * 1024 * 1024;

  /**
   * The most one archive may weigh, whatever an admin sets.
   *
   * ## ⚠️ Bounded by the platform, not by taste
   *
   * A push holds the whole archive in memory, in an isolate of 128 MB shared
   * with everything else Lore is doing, and reading its manifest inflates
   * part of it beside the bytes. This is the ceiling the push schema's
   * `z.file({ maxBytes })` declares, so the multipart decode refuses a larger
   * part before it is ever buffered; the parameter can only lower it.
   */
  public static readonly MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

  /**
   * Overridable from `/admin/parameters` without a redeploy, as
   * `DeployLimits` and `ProjectLimits` are.
   *
   * ⚠️ Every key is OPTIONAL, for the reason `ProjectLimits` writes down:
   * `ParameterProvider` returns a version saved under an older schema hash
   * as-is, so a key added later comes back `undefined` from an override an
   * admin already set. The helpers below put the default behind each one.
   */
  public readonly limits = $parameter({
    name: "lore.artifact.limits",
    description:
      "How many artifacts a project may keep, how large one archive may be, and how many bytes its archives may hold in all.",
    schema: z.object({
      maxArtifactsPerProject: z.integer().min(1).max(100_000).optional(),
      // Capped by the platform; see MAX_ARTIFACT_BYTES.
      maxArtifactBytes: z
        .integer()
        .min(1024)
        .max(ArtifactLimits.MAX_ARTIFACT_BYTES)
        .optional(),
      maxBytesPerProject: z
        .integer()
        .min(1024)
        .max(1024 * 1024 * 1024 * 1024)
        .optional(),
    }),
    default: {
      maxArtifactsPerProject: ArtifactLimits.DEFAULT_MAX_ARTIFACTS,
      maxArtifactBytes: ArtifactLimits.DEFAULT_MAX_ARTIFACT_BYTES,
      maxBytesPerProject: ArtifactLimits.DEFAULT_MAX_BYTES_PER_PROJECT,
    },
  });

  public async maxArtifactsPerProject(): Promise<number> {
    return (
      (await this.limits.get()).maxArtifactsPerProject ??
      ArtifactLimits.DEFAULT_MAX_ARTIFACTS
    );
  }

  /**
   * One archive's cap, never past {@link MAX_ARTIFACT_BYTES}.
   *
   * ⚠️ Clamped here as well as in the schema, as `DeployLimits.timeoutMs()`
   * is: a version saved under an older schema comes back as-is, unchecked.
   */
  public async maxArtifactBytes(): Promise<number> {
    return Math.min(
      (await this.limits.get()).maxArtifactBytes ??
        ArtifactLimits.DEFAULT_MAX_ARTIFACT_BYTES,
      ArtifactLimits.MAX_ARTIFACT_BYTES,
    );
  }

  public async maxBytesPerProject(): Promise<number> {
    return (
      (await this.limits.get()).maxBytesPerProject ??
      ArtifactLimits.DEFAULT_MAX_BYTES_PER_PROJECT
    );
  }

  /**
   * A byte count as a person reads it in a refusal: `25 MB`, `1.4 MB`.
   */
  public static megabytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
}
