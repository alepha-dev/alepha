import {
  BoundParameters,
  LiveQuestRegistry,
  ProjectSecurityService,
} from "@lore/core/api";
import { $inject, createPagination, type Page } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { type Quest, quests } from "../entities/quests.ts";
import type { QuestLiveCopy } from "../schemas/questLiveCopySchema.ts";

/**
 * The quest list's half of live quests (#E154): the copies running each
 * quest, and the Done filter "completed, not live anywhere". Read through
 * core's `LiveQuestRegistry`, so Plan never imports a Ship service.
 */
export class PlanLiveQuests {
  protected readonly registry = $inject(LiveQuestRegistry);
  protected readonly bound = $inject(BoundParameters);
  protected readonly quests = $repository(quests);
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);

  /**
   * Whether the reader may see which copies run a quest: the app names are
   * Ship's, behind `app:read`, which a viewer of an open project does not
   * hold (#Q3794). `quest:read` alone gets no live data at all.
   *
   * `RankService.can` answers from the rank the project gate already
   * resolved for this caller in this request, and the organization id is a
   * cached read, so the check costs no D1 trip on a gated route.
   */
  public async readsApps(
    projectId: number,
    user: UserAccountToken | undefined,
  ): Promise<boolean> {
    if (!user) {
      return false;
    }
    return await this.ranks.can(
      await this.projectSecurity.organizationIdOf(projectId),
      "app:read",
      user,
    );
  }

  /**
   * Quest number to the copies running it, or `undefined` when Lore cannot
   * say (no Ship module).
   */
  public async liveByNumber(
    projectId: number,
  ): Promise<Map<number, QuestLiveCopy[]> | undefined> {
    const liveness = await this.registry.projectLiveness(projectId);
    if (!liveness) {
      return undefined;
    }
    return new Map(
      [...liveness.live].map(([n, copies]) => [
        n,
        copies.map((it) => ({ app: it.app, env: it.env, dirty: it.dirty })),
      ]),
    );
  }

  /**
   * One page of "completed, not live anywhere": the quests the `where`
   * matches that have at least one recorded commit (a quest closed with no
   * commit can never be live, the rule "behind" follows too) and that no
   * copy runs.
   *
   * ⚠️ **Nothing is listed while any deployed copy's set is unknown or
   * partial**: "not live" is never claimed from a set Lore does not hold.
   *
   * ⚠️ D1 refuses more than 100 bound parameters, so the live set is never
   * bound into the query: the matching ids are read, the live ones dropped
   * in memory, then the page is read by id in chunks.
   */
  public async notLivePage(
    projectId: number,
    where: Record<string, any>,
    query: { page?: number; size?: number; sort?: string },
    offset?: number,
  ): Promise<Page<Quest>> {
    const size = query.size ?? 10;
    const start = offset ?? (query.page ?? 0) * size;
    const orderBy = (query.sort ?? "-completedAt").split(",").map((part) => {
      const column = part.trim().replace(/^-/, "");
      return {
        column,
        direction: part.trim().startsWith("-") ? "desc" : "asc",
      } as const;
    });

    const liveness = await this.registry.projectLiveness(projectId);
    if (!liveness?.settled) {
      return createPagination([], size, start, orderBy);
    }

    const candidates = await this.quests.findMany({
      where: {
        ...where,
        completedAt: { ...where.completedAt, isNotNull: true },
        commits: { isNotNull: true },
      },
      columns: ["id", "shortId", "commits"],
      orderBy: orderBy as any,
    });
    const kept = candidates.filter(
      (row) =>
        (row.commits?.length ?? 0) > 0 && !liveness.live.has(row.shortId),
    );
    const ids = kept.slice(start, start + size + 1).map((row) => row.id);
    const rows = await this.bound.collect(ids, (batch) =>
      this.quests.findMany({ where: { id: { inArray: batch } } }),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    const page = createPagination(ordered, size, start, orderBy);
    page.page.totalElements = kept.length;
    page.page.totalPages = Math.ceil(kept.length / size);
    return page;
  }
}
