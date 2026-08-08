import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import { orderSearchHits } from "../searchRanking.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * One row of a search result, whatever it turned out to be.
 *
 * The whole point of this controller is that callers get ONE shape. The
 * underlying tables disagree about almost everything — a quest's label is
 * `title`, a directory's is `name`; a folio carries `protected` as a flag
 * while `kind` says "folio" — and normalising that in each caller is how
 * the palette's first version ended up mis-mapping three fields.
 */
const searchHitSchema = z.object({
  kind: z.enum(["quest", "folio", "directory"]),
  id: z.string(),
  shortId: z.integer(),
  title: z.string(),
  /**
   * Set only for a protected folio, so a caller can mark it without
   * having to know that "protected" is a flag rather than a kind.
   */
  protected: z.boolean().optional(),
});

/**
 * Project-wide search across every surface at once — what the ⌘K palette
 * runs, and the answer to "find anything called X".
 *
 * Exists as its own action rather than the palette calling `getQuests`
 * and `searchFolio` side by side, for three reasons that survived
 * measuring:
 *
 * - **Shape.** Those two return incompatible rows (`{content,page}` of
 *   full quest resources vs `entries` with `name`), and reconciling them
 *   is business logic that was living in a React component.
 * - **Size.** `getQuests` returns the whole quest — description, tags,
 *   dates, source — and `searchFolio` adds `updatedAt`/`size`/`summary`.
 *   A palette row needs four fields.
 * - **Ranking.** Separate calls can only produce fixed per-type groups.
 *   Ranked together, an exact title match beats a body match no matter
 *   which table it came from — see `orderSearchHits`.
 *
 * Round trips were NOT a reason: `BatchCollector` already coalesces
 * concurrent client calls into one `POST /api/_batch`.
 */
export class SearchController {
  protected readonly quests = $repository(quests);
  protected readonly folios = $repository(folios);
  protected readonly directories = $repository(folioDirectories);
  protected readonly security = $inject(ProjectSecurityService);

  search = $action({
    use: [$secure({ permissions: ["quest:read", "folio:read"] })],
    path: "/projects/:projectId/search",
    description:
      "Search quests, folios and directories in one project by name.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        q: z.string().min(1),
        limit: z.integer().min(1).max(50).optional(),
      }),
      response: z.object({ hits: z.array(searchHitSchema) }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.projectId, user);

      const raw = query.q.trim();
      const needle = raw.toLowerCase();
      const limit = query.limit ?? 12;

      // `#42` (or a bare `42`) means "the quest with that shortId" — the
      // shortcut `getQuests` already offered, kept because people type it.
      const idMatch = raw.match(/^#?(\d+)$/);

      const [questRows, folioRows, directoryRows] = await Promise.all([
        this.quests.findMany({
          where: idMatch
            ? {
                projectId: { eq: params.projectId },
                shortId: { eq: Number.parseInt(idMatch[1], 10) },
              }
            : {
                projectId: { eq: params.projectId },
                title: { ilike: `%${raw}%` },
              },
          limit,
        }),
        this.folios.findMany({
          where: {
            projectId: { eq: params.projectId },
            searchText: { like: `%${needle}%` },
          },
          limit,
        }),
        this.directories.findMany({
          where: {
            projectId: { eq: params.projectId },
            name: { like: `%${raw}%` },
          },
          limit,
        }),
      ]);

      const hits = [
        ...questRows.map((q) => ({
          kind: "quest" as const,
          id: String(q.id),
          shortId: q.shortId,
          title: q.title,
        })),
        ...folioRows.map((f) => ({
          kind: "folio" as const,
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          protected: f.protected || undefined,
        })),
        ...directoryRows.map((d) => ({
          kind: "directory" as const,
          id: d.id,
          shortId: d.shortId,
          title: d.name,
        })),
      ];

      return { hits: orderSearchHits(hits, needle, !!idMatch, limit) };
    },
  });
}
