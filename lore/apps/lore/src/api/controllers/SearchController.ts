import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { parseTypedReference } from "../../web/app/components/shared/element/typedReference.ts";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
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
import { searchHitSchema } from "../schemas/searchHitSchema.ts";
import { orderSearchHits } from "../searchRanking.ts";
/**
 * One row of a search result, whatever it turned out to be.
 *
 * The whole point of this controller is that callers get ONE shape. The
 * underlying tables disagree about almost everything — a quest's label is
 * `title`, a directory's is `name`; a folio carries `protected` as a flag
 * while `kind` says "folio" — and normalising that in each caller is how
 * the palette's first version ended up mis-mapping three fields.
 */
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class SearchController {
  /**
   * Characters of body context a palette row shows. Enough for a sentence,
   * short enough that twelve of them do not outweigh the titles.
   */
  protected readonly MAX_PREVIEW = 140;

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

      // `#42` (or a bare `42`) means "the thing with that shortId", and
      // quests, folios and directories all carry one: it is the addressing
      // form of `/quests/:shortId`, `/folios/:shortId` and `/folios/d/:shortId`.
      // The lookup used to reach quests only, so `44` typed while reading
      // folio #44 returned quest #44 and two folios whose BODY contained
      // "44", and never the folio itself (quest #1676).
      //
      // Added to each table's text search rather than replacing it: the
      // body matches are not wrong, only less likely, so they stay
      // underneath. `orderSearchHits` pins the exact hits above them.
      //
      // The typed form (epic #32), `#Q42` or `#F42`, names the kind as well
      // and restricts the id match to that one table: it is the very
      // ambiguity the palette used to show, taken on the way in. A letter
      // for a kind this search does not index matches nothing by id. The
      // untyped `#42` and `42` keep reaching all three tables, so nobody is
      // made to type the letter to search.
      const typed = parseTypedReference(raw);
      const idMatch = typed ? undefined : raw.match(/^#?(\d+)$/);
      const untypedId = idMatch ? Number.parseInt(idMatch[1], 10) : undefined;
      const idFor = (kind: "quest" | "folio" | "directory") =>
        typed ? (typed.kind === kind ? typed.id : undefined) : untypedId;
      const questId = idFor("quest");
      const folioId = idFor("folio");
      const directoryId = idFor("directory");
      const id = typed?.id ?? untypedId;

      const [questRows, folioRows, directoryRows] = await Promise.all([
        this.quests.findMany({
          where: {
            projectId: { eq: params.projectId },
            ...(questId === undefined
              ? { title: { ilike: `%${raw}%` } }
              : {
                  or: [
                    { shortId: { eq: questId } },
                    { title: { ilike: `%${raw}%` } },
                  ],
                }),
          },
          limit,
        }),
        this.folios.findMany({
          where: {
            projectId: { eq: params.projectId },
            ...(folioId === undefined
              ? { searchText: { like: `%${needle}%` } }
              : {
                  or: [
                    { shortId: { eq: folioId } },
                    { searchText: { like: `%${needle}%` } },
                  ],
                }),
          },
          limit,
        }),
        this.directories.findMany({
          where: {
            projectId: { eq: params.projectId },
            ...(directoryId === undefined
              ? { name: { like: `%${raw}%` } }
              : {
                  or: [
                    { shortId: { eq: directoryId } },
                    { name: { like: `%${raw}%` } },
                  ],
                }),
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
          description: this.preview(q.description),
        })),
        ...folioRows.map((f) => ({
          kind: "folio" as const,
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          description: this.preview(f.summary),
          protected: f.protected || undefined,
        })),
        ...directoryRows.map((d) => ({
          kind: "directory" as const,
          id: d.id,
          shortId: d.shortId,
          title: d.name,
        })),
      ];

      return { hits: orderSearchHits(hits, needle, id, limit) };
    },
  });

  /**
   * Collapse a body down to one short line fit for a palette row.
   *
   * Markdown is flattened rather than rendered — the palette shows plain
   * muted text, and leaving `##` or `**` in would put syntax on screen. This
   * is intentionally cruder than the folio hover card's `stripMarkdown`: at
   * ~140 characters the difference between a good strip and a rough one is
   * invisible, and the alternative is a second copy of that helper on the
   * server for no gain.
   */
  protected preview(raw: string | null | undefined): string | undefined {
    if (!raw) return undefined;
    const flat = raw
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`~[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!flat) return undefined;
    return flat.length > this.MAX_PREVIEW
      ? `${flat.slice(0, this.MAX_PREVIEW)}…`
      : flat;
  }
}
