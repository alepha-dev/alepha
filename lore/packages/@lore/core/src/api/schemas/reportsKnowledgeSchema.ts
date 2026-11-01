import { type Infer, z } from "alepha";

const folioRef = z.object({
  shortId: z.integer(),
  title: z.string(),
});

/**
 * The Reports Knowledge tab (#Q3007): how the project's memory is kept.
 */
export const reportsKnowledgeSchema = z.object({
  total: z.integer(),
  /**
   * Folios created and revisions recorded per grain.
   */
  activity: z.array(
    z.object({
      date: z.string(),
      created: z.integer(),
      revised: z.integer(),
    }),
  ),
  /**
   * The folios with the most revisions in the period.
   */
  mostRevised: z.array(folioRef.extend({ revisions: z.integer() })),
  /**
   * Folios not updated for the stale threshold, pinned first, then oldest.
   */
  stale: z.array(folioRef.extend({ pinned: z.boolean(), days: z.number() })),
  staleCount: z.integer(),
  staleDays: z.integer(),
  /**
   * Folios nothing links to, pinned ones left out: pinning is a way in.
   */
  orphans: z.array(folioRef),
  orphanCount: z.integer(),
  medianLinksPerFolio: z.number(),
  /**
   * The folios most linked to.
   */
  mostLinked: z.array(folioRef.extend({ links: z.integer() })),
  /**
   * Folios per top-level directory. `/` is the project root.
   */
  byDirectory: z.array(z.object({ name: z.string(), count: z.integer() })),
  /**
   * Revisions that reverted a folio, in the period.
   */
  reverts: z.integer(),
});

export type ReportsKnowledge = Infer<typeof reportsKnowledgeSchema>;
