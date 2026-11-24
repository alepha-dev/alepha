import { type Infer, z } from "alepha";

/**
 * A project's folios and the wiki links between them (#Q4262), for the
 * folio graph: one node per folio, one edge per folio-to-folio `[[...]]`
 * link.
 */
export const folioGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.uuid(),
      shortId: z.integer(),
      title: z.string(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.uuid(),
      to: z.uuid(),
    }),
  ),
});

export type FolioGraph = Infer<typeof folioGraphSchema>;
