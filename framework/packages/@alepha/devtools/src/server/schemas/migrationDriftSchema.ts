import { type Infer, z } from "alepha";

/**
 * Migration files of one app that differ from the default branch.
 */
export const migrationDriftSchema = z.object({
  /**
   * What the files were compared against (`origin/main`). Absent when there
   * was nothing to compare with: no remote, or no common ancestor.
   */
  base: z.text().optional(),
  files: z.array(
    z.object({
      /**
       * Relative to the app's directory: `migrations/postgres/0004_x.sql`.
       */
      path: z.text({ size: "long" }),
      status: z.enum(["added", "modified"]),
    }),
  ),
});

export type MigrationDrift = Infer<typeof migrationDriftSchema>;
