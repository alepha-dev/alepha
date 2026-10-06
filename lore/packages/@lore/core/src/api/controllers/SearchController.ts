import { $inject, type Infer, z } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { $action } from "alepha/server";

import { ResourceRegistry } from "../resources/ResourceRegistry.ts";
/**
 * One row of a search result, whatever it turned out to be.
 *
 * The whole point of this controller is that callers get ONE shape. The
 * underlying tables disagree about almost everything — a quest's label is
 * `title`, a directory's is `name`; a folio carries `protected` as a flag
 * while `kind` says "folio" — and normalising that in each caller is how
 * the palette's first version ended up mis-mapping three fields.
 */
import { CapabilityRegistry } from "../schemas/CapabilityRegistry.ts";
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
 *
 * It reads no module's table: every kind it finds is a search source a
 * module registered on the `ResourceRegistry` (#E75, #Q2610), so a kind no
 * module registers is simply never found. Ranking stays here and applies to
 * every source alike.
 */
import { searchHitSchema } from "../schemas/searchHitSchema.ts";
import { orderSearchHits } from "../searchRanking.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectPermissions } from "../security/ProjectPermissions.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class SearchController {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly members = $repository(organizationMembers);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly registry = $inject(CapabilityRegistry);
  protected readonly permissions = $inject(ProjectPermissions);

  search = $action({
    use: [
      $ownsProject({
        requires: ["quest:read", "folio:read"],
        param: "projectId",
      }),
    ],
    path: "/projects/:projectId/search",
    description:
      "Search quests, folios and directories in one project by name, and every kind by its number.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        q: z.string().min(1),
        limit: z.integer().min(1).max(50).optional(),
      }),
      response: z.object({ hits: z.array(searchHitSchema) }),
    },
    handler: async ({ params, query, user }) => {
      // ⚠️ **The palette is Core; the tables it reaches into are not.** A
      // Knowledge-only project must never answer with a quest: disabling
      // hides, so the rows are still there and a search that found them would
      // be the one surface still offering a way into a capability the project
      // turned off. Skipped rather than filtered afterwards, so a disabled
      // kind costs no statement.
      //
      // The read is the same memoised, 30s-cached one every gate on this
      // request already paid for.
      //
      // Option-aware since #Q2228: an epic or a release is offered only while
      // its Work option is on, like its sidebar entry and its feed rows.
      const capabilities = await this.security.capabilitiesOf(params.projectId);
      const indexes = (kind: SearchKind) =>
        this.registry.isSearchKindEnabled(kind, capabilities);

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
      // ambiguity the palette used to show, taken on the way in. The untyped
      // `#42` and `42` keep reaching every table, so nobody is made to type
      // the letter to search.
      //
      // Epics, releases and feedback answer an id query ONLY (#Q2228):
      // `#E52`, `#R3`, `#P12`, or a bare number reaching all six kinds. They
      // are not matched by title, which is what the report asked for and
      // keeps twelve palette rows from filling with three more kinds of
      // near-miss. Whether they should also match by title is the owner's
      // call, left open on the quest.
      const typed = this.resources.parseReference(raw);
      const idMatch = typed ? undefined : raw.match(/^#?(\d+)$/);
      const untypedId = idMatch ? Number.parseInt(idMatch[1], 10) : undefined;
      const idFor = (kind: string) =>
        typed ? (typed.kind === kind ? typed.number : undefined) : untypedId;
      const id = typed?.number ?? untypedId;

      // Every registered source this project indexes. A number-only kind
      // (epics, releases, feedback) runs only when a number was typed.
      const sources = this.resources
        .all()
        .filter(
          (kind) =>
            kind.search &&
            indexes(kind.kind as SearchKind) &&
            (!kind.search.numberOnly || idFor(kind.kind) !== undefined),
        );

      // ⚠️ Each number-only kind is filtered by its OWN read permission, and
      // none of them is in `requires`: a rank without `feedback:read` must
      // still get quests and folios, not lose the whole palette. Read only
      // when a number-only kind would run, since nothing else needs it.
      const granted = sources.some((kind) => kind.search?.numberOnly)
        ? await this.grantedIn(params.projectId, user)
        : new Set<string>();

      const found = await Promise.all(
        sources
          .filter(
            (kind) => !kind.search?.numberOnly || granted.has(kind.permission),
          )
          .map((kind) =>
            kind.search!.find({
              projectId: params.projectId,
              raw,
              needle,
              number: idFor(kind.kind),
              limit,
            }),
          ),
      );
      const hits = found.flat();

      return { hits: orderSearchHits(hits, needle, id, limit) };
    },
  });

  /**
   * The caller's effective permissions in this project, for the kinds the
   * action's own gate does not cover.
   *
   * Through `ProjectPermissions`, the one place effective access (role AND
   * rank AND capability) is computed, so the palette cannot disagree with
   * the page it would open. The rank definitions and capability rows it
   * reads are memoised for the request; the membership row is one query.
   */
  protected async grantedIn(
    projectId: number,
    user: UserAccountToken,
  ): Promise<Set<string>> {
    const member = await this.members.findOne({
      where: {
        organizationId: {
          eq: await this.security.organizationIdOf(projectId),
        },
        userId: { eq: user.id },
      },
    });
    const { permissions } = await this.permissions.of(projectId, user, member);
    return new Set(permissions);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A kind the palette searches, as the hit schema names it.
 */
type SearchKind = Infer<typeof searchHitSchema>["kind"];
