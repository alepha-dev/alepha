import { type Infer, z } from "alepha";

/**
 * What the one-shot reference converter of epic #32 reports, per project,
 * per rewritten row, and per token. The same shape comes back from a dry
 * run and from a write, so the operator compares the two by eye before
 * anything is stored.
 *
 * `z.string()` rather than `z.text()` on every free field on purpose: a
 * token carries a folio title of up to 200 characters plus its brackets,
 * and a capped field would make the report fail to serialize on exactly
 * the rows worth reading.
 */
export const referenceConversionReportSchema = z.object({
  dryRun: z.boolean(),
  /**
   * `folio_links` rows whose target is a blob, counted before the run. A
   * write leaves none: the re-sync of every rewritten body drops its own,
   * and the rest are deleted last, because the purge removes the `blob`
   * literal from the enum and a stored value the enum no longer has fails
   * validation on read.
   */
  blobLinks: z.integer(),
  /**
   * Changed rows no call has written yet, summed over the projects below.
   * A write stops at its `limit` and the operator's page calls again until
   * this reads 0; a dry run reports every changed row here.
   */
  remaining: z.integer(),
  projects: z.array(
    z.object({
      projectId: z.integer(),
      slug: z.string(),
      /**
       * Bodies read: every non-protected folio, each of a quest's three
       * markdown fields, every epic, every quest comment, every release.
       */
      scanned: z.integer(),
      /**
       * Bodies whose text changes (dry run), or whose text this call wrote
       * (write).
       */
      rewritten: z.integer(),
      /**
       * Changed bodies this call did not write, left for the next one.
       */
      remaining: z.integer(),
      /**
       * Protected folios, whose ciphertext the server never reads. Their
       * title references break at the purge unless fixed by hand first.
       */
      skippedProtected: z.integer(),
      anchorsDropped: z.integer(),
      unresolved: z.integer(),
      rows: z.array(
        z.object({
          kind: z.enum(["folio", "quest", "epic", "comment", "release"]),
          id: z.string(),
          /**
           * The number a person knows the row by: a folio's, quest's or
           * feedback's `shortId`, an epic's or release's `number`, a
           * comment's own id.
           */
          number: z.integer(),
          field: z.string(),
          tokens: z.array(
            z.object({
              before: z.string(),
              after: z.string(),
              count: z.integer(),
            }),
          ),
          anchorsDropped: z.integer(),
          /**
           * Tokens left verbatim because nothing resolved them. A broken
           * link the author can see beats a silently deleted reference.
           */
          unresolved: z.array(z.string()),
        }),
      ),
    }),
  ),
});

export type ReferenceConversionReport = Infer<
  typeof referenceConversionReportSchema
>;
export type ProjectReferenceConversion =
  ReferenceConversionReport["projects"][number];
export type ReferenceRowConversion = ProjectReferenceConversion["rows"][number];
