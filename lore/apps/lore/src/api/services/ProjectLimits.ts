import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Lore-wide soft caps on project / membership / quest growth. Versioned
 * via `$parameter` so an admin can bump them from `/admin/parameters`
 * without a redeploy. Each call site reads the current value with
 * `await this.limits.maxProjectsPerUser.get()` (or the slim helpers
 * below) so a change goes live across instances within one notification
 * round-trip.
 */
export class ProjectLimits {
  limits = $parameter({
    // Name value kept as "lore.campaign.limits", not renamed to
    // "lore.project.limits": `$parameter` persists overrides keyed by this
    // exact string in the `parameters` table (set via /admin/parameters) —
    // same reasoning that keeps the storage bucket names
    // (`campaign-icons`, `archive-blobs`, `petition-attachments`)
    // un-renamed after their entity-level renames. Renaming the key would
    // silently orphan any override an admin has already set, with no error
    // — the app would fall back to the hardcoded `default` below.
    name: "lore.campaign.limits",
    description:
      "Per-user / per-project hard caps. Bump for power users without a redeploy.",
    schema: z.object({
      maxProjectsPerUser: z.integer().min(1).max(10_000),
      maxMembersPerProject: z.integer().min(1).max(10_000),
      maxQuestsPerProject: z.integer().min(1).max(100_000),
      maxReleasesPerProject: z.integer().min(1).max(1_000),
      /**
       * ⚠️ Optional where the four above are required, and that is not
       * sloppiness.
       *
       * `ParameterProvider` validates content against the current schema only
       * when the stored SCHEMA HASH matches; a version saved under an older
       * hash is returned as-is. So an override an admin has already set for
       * this parameter comes back missing any key added later, and a required
       * key would be `undefined` at the call site with the type saying
       * otherwise. For a retention cap that reads as "keep zero rows".
       *
       * Optional here, with {@link ProjectLimits.DEFAULT_MAX_QUALITY_RUNS}
       * behind it in the helper, so an old override loses the new knob rather
       * than the whole sweep.
       */
      maxQualityRunsPerProject: z.integer().min(1).max(100_000).optional(),
    }),
    default: {
      maxProjectsPerUser: 10,
      maxMembersPerProject: 100,
      maxQuestsPerProject: 5_000,
      maxReleasesPerProject: 200,
      maxQualityRunsPerProject: 500,
    },
  });

  /**
   * Runs kept per project when nothing says otherwise.
   *
   * 500 is roughly a year of daily pushes on one branch, and the reason there
   * is a cap at all rather than a `$storage` TTL: a TTL would have
   * `api:files:purgeFiles` delete the raw reports hourly once past expiry,
   * destroying exactly the history that justifies keeping them.
   */
  public static readonly DEFAULT_MAX_QUALITY_RUNS = 500;

  /**
   * Maximum number of projects a single user can create. Read at the
   * top of `ProjectController.createProject`.
   */
  public async maxProjectsPerUser(): Promise<number> {
    return (await this.limits.get()).maxProjectsPerUser;
  }

  /**
   * Maximum number of members on a single project.
   */
  public async maxMembersPerProject(): Promise<number> {
    return (await this.limits.get()).maxMembersPerProject;
  }

  /**
   * Maximum number of quests under a single project.
   */
  public async maxQuestsPerProject(): Promise<number> {
    return (await this.limits.get()).maxQuestsPerProject;
  }

  /**
   * Maximum number of releases under a single project.
   */
  public async maxReleasesPerProject(): Promise<number> {
    return (await this.limits.get()).maxReleasesPerProject;
  }

  /**
   * Quality runs kept per project. Read by the `$job` sweep in `QualityJobs`.
   *
   * Falls back rather than trusting the stored value to carry the key - see
   * the note on the schema field above.
   */
  public async maxQualityRunsPerProject(): Promise<number> {
    return (
      (await this.limits.get()).maxQualityRunsPerProject ??
      ProjectLimits.DEFAULT_MAX_QUALITY_RUNS
    );
  }
}
