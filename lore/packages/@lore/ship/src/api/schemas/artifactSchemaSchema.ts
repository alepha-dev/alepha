import { type Infer, z } from "alepha";

/**
 * One dialect's database schema as a build expects it (#Q3542), reduced from
 * the newest Drizzle `snapshot.json` the build ships under
 * `migrations/<dialect>/`.
 *
 * Only what decides whether OLDER code still runs on a NEWER schema is kept:
 * per column its type, whether it is `NOT NULL` and whether an insert that
 * omits it gets a value anyway; and the constraints that can refuse a write
 * (unique indexes, foreign keys, checks), each as one comparable string.
 * Non-unique indexes and primary keys are left out: adding or dropping one
 * changes no query's outcome.
 */
export const artifactDialectSchemaSchema = z.object({
  tables: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        type: z.string(),
        notNull: z.boolean(),
        /**
         * A default, an autoincrement or a generated value: an insert that
         * leaves the column out still succeeds.
         */
        filled: z.boolean(),
      }),
    ),
  ),
  /**
   * `<kind> <table> <definition>`, one per unique index, foreign key and
   * check. The definition is the whole of it, so a constraint redefined under
   * the same name reads as one removed and one added.
   */
  constraints: z.array(z.string()),
});

export type ArtifactDialectSchema = Infer<typeof artifactDialectSchemaSchema>;

/**
 * What Lore stores beside an archive: the reduced schema of every dialect the
 * build ships migrations for. Keyed by dialect, because one build can carry
 * both `sqlite` (D1) and `postgres` migrations and runs on one of them.
 */
export const artifactSchemaSchema = z.object({
  version: z.literal(1),
  sha256: z.string(),
  dialects: z.record(z.string(), artifactDialectSchemaSchema),
});

export type ArtifactSchema = Infer<typeof artifactSchemaSchema>;
