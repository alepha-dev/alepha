import { BoundParameters, ResourceLinkService } from "@lore/core/api";
import { EpicController } from "@lore/plan/api";
import { compareReleaseTags, epics, releases } from "@lore/plan/schemas";
import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { personas } from "../entities/personas.ts";
import { requirementMetricDays } from "../entities/requirementMetricDays.ts";
import { type Requirement, requirements } from "../entities/requirements.ts";
import { useCaseActors } from "../entities/useCaseActors.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import type { ReleaseMove } from "../schemas/releaseMoveSchema.ts";
import type { RequirementResource } from "../schemas/requirementResourceSchema.ts";
import { RunService } from "./RunService.ts";

/**
 * What a requirement is verified by, covered by and shipped in (#E153):
 *
 * - **verified by** the criteria whose `requirementId` names it;
 * - **covered by** the epics covering those criteria's use cases;
 * - **target release**: `auto`, derived on read from the covering epics'
 *   releases, the latest when they differ, never stored; else the release
 *   stored BY HAND, which counts only while no covering epic sits in one.
 *
 * No listener and no second write keep `auto` in step: an epic moved to
 * another release moves its requirements on the next read.
 */
export class RequirementService {
  protected readonly alepha = $inject(Alepha);
  protected readonly requirements = $repository(requirements);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly useCases = $repository(useCases);
  protected readonly actors = $repository(useCaseActors);
  protected readonly personas = $repository(personas);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly runService = $inject(RunService);
  protected readonly metricDays = $repository(requirementMetricDays);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly bound = $inject(BoundParameters);

  /**
   * Every requirement of `rows` as a resource, in a fixed number of reads.
   */
  public async toResources(
    rows: Requirement[],
  ): Promise<RequirementResource[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((it) => it.id);
    // Every id list below goes in batches under D1's bind limit (#Q3959).
    const criteria = await this.bound.collect(ids, (batch) =>
      this.criteria.findMany({
        where: { requirementId: { inArray: batch } },
        orderBy: [{ column: "key", direction: "asc" }],
      }),
    );
    const useCaseIds = [...new Set(criteria.map((it) => it.useCaseId))];
    const [cases, actors, covers] = await Promise.all([
      this.bound.collect(useCaseIds, (batch) =>
        this.useCases.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "number", "title"],
        }),
      ),
      this.bound.collect(useCaseIds, (batch) =>
        this.actors.findMany({ where: { useCaseId: { inArray: batch } } }),
      ),
      this.links.relationsTo("covers", "usecase", useCaseIds.map(String)),
    ]);
    const metricIds = rows.filter((it) => it.metric).map((it) => it.id);
    const [latest, development, days] = await Promise.all([
      this.runService.latestOf(useCaseIds),
      this.runService.developmentOf(useCaseIds),
      this.bound.collect(metricIds, (batch) =>
        this.metricDays.findMany({
          where: {
            requirementId: { inArray: batch },
            day: { gte: this.dayOf(-13) },
          },
          orderBy: [{ column: "day", direction: "asc" }],
        }),
      ),
    ]);
    const epicIds = [...new Set(covers.map((it) => Number(it.fromId)))];
    const personaIds = [...new Set(actors.map((it) => it.personaId))];
    const [epicRows, people] = await Promise.all([
      this.bound.collect(epicIds, (batch) =>
        this.epics.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "number", "title", "releaseId"],
        }),
      ),
      this.bound.collect(personaIds, (batch) =>
        this.personas.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "number", "name"],
        }),
      ),
    ]);
    const releaseIds = [
      ...new Set([
        ...epicRows.flatMap((it) => (it.releaseId ? [it.releaseId] : [])),
        ...rows.flatMap((it) =>
          it.targetReleaseId ? [it.targetReleaseId] : [],
        ),
      ]),
    ];
    const releaseRows = await this.bound.collect(releaseIds, (batch) =>
      this.releases.findMany({
        where: { id: { inArray: batch } },
        columns: ["id", "number", "tag", "title"],
      }),
    );
    const release = new Map(releaseRows.map((it) => [it.id, it]));
    const useCase = new Map(cases.map((it) => [it.id, it]));
    const epic = new Map(epicRows.map((it) => [it.id, it]));
    const person = new Map(people.map((it) => [it.id, it]));

    return rows.map((row) => {
      const { deletedAt: _deleted, ...rest } = row;
      const mine = criteria.filter((c) => c.requirementId === row.id);
      const myCases = new Set(mine.map((c) => c.useCaseId));
      const myEpics = [
        ...new Set(
          covers
            .filter((it) => myCases.has(Number(it.toId)))
            .map((it) => Number(it.fromId)),
        ),
      ].flatMap((id) => (epic.get(id) ? [epic.get(id)!] : []));
      const myPeople = [
        ...new Set(
          actors
            .filter((a) => myCases.has(a.useCaseId))
            .map((a) => a.personaId),
        ),
      ].flatMap((id) => (person.get(id) ? [person.get(id)!] : []));
      const auto = this.latest(
        myEpics.flatMap((it) =>
          it.releaseId && release.get(it.releaseId)
            ? [release.get(it.releaseId)!]
            : [],
        ),
      );
      const byHand = row.targetReleaseId
        ? release.get(row.targetReleaseId)
        : undefined;
      const target = auto ?? byHand;
      return {
        ...rest,
        criteria: mine.map((c) => ({
          result: latest
            .get(c.useCaseId)
            ?.results.find((r) => r.criterionKey === c.key)?.result,
          useCaseId: c.useCaseId,
          useCaseNumber: useCase.get(c.useCaseId)?.number ?? 0,
          useCaseTitle: useCase.get(c.useCaseId)?.title ?? "",
          key: c.key,
          summary:
            c.text ??
            [c.givenText, c.whenText, c.thenText].filter(Boolean).join(" · "),
          method: c.method,
        })),
        coveringEpics: myEpics.map((it) => ({
          id: it.id,
          number: it.number,
          title: it.title,
          releaseId: it.releaseId,
        })),
        personas: myPeople
          .sort((a, b) => a.number - b.number)
          .map((it) => ({ number: it.number, name: it.name })),
        targetRelease: target
          ? {
              id: target.id,
              number: target.number,
              tag: target.tag,
              title: target.title,
              mode: auto ? ("auto" as const) : ("by_hand" as const),
            }
          : undefined,
        status: row.metric
          ? (row.metricStatus ?? "no_data")
          : this.statusOf(mine, latest, development),
        metricDays: days
          .filter((it) => it.requirementId === row.id)
          .map((it) => ({ day: it.day, value: it.value, status: it.status })),
      };
    });
  }

  /**
   * `YYYY-MM-DD` (UTC) of today plus `offset` days.
   */
  protected dayOf(offset: number): string {
    return this.dt.now().add(offset, "day").toISOString().slice(0, 10);
  }

  /**
   * A requirement's status from the latest result of each criterion
   * verifying it (#Q3770): not covered without one; failing when one failed
   * and its use case's quests are all done, in development while they are
   * not; verified when every one passed; covered otherwise (never run).
   */
  protected statusOf(
    criteria: Array<{ useCaseId: number; key: string }>,
    latest: Map<
      number,
      { results: Array<{ criterionKey: string; result: string }> }
    >,
    development: Map<number, { done: boolean }>,
  ): RequirementResource["status"] {
    if (criteria.length === 0) return "not_covered";
    const results = criteria.map(
      (c) =>
        [
          c,
          latest.get(c.useCaseId)?.results.find((r) => r.criterionKey === c.key)
            ?.result,
        ] as const,
    );
    const failed = results.filter(([, result]) => result === "failed");
    if (failed.length) {
      return failed.some(([c]) => development.get(c.useCaseId)?.done)
        ? "failing"
        : "in_development";
    }
    return results.every(([, result]) => result === "passed")
      ? "verified"
      : "covered";
  }

  /**
   * The latest of several releases: by tag order where both carry a tag,
   * else by number.
   */
  protected latest<T extends { number: number; tag?: string | null }>(
    list: T[],
  ): T | undefined {
    return [...list].sort((a, b) =>
      a.tag && b.tag ? compareReleaseTags(b.tag, a.tag) : b.number - a.number,
    )[0];
  }

  /**
   * What setting `releaseId` on a covered requirement would move: every
   * covering epic not already in it, each with the other requirements it
   * covers. Answers `ask` when one of them covers others or sits in another
   * release, which the UI confirms first.
   */
  public async movesFor(
    resource: RequirementResource,
    releaseId: number,
  ): Promise<{ moves: ReleaseMove[]; ask: boolean }> {
    const moving = resource.coveringEpics.filter(
      (it) => it.releaseId !== releaseId,
    );
    if (moving.length === 0) return { moves: [], ask: false };
    const others = await this.requirementsCoveredBy(moving.map((it) => it.id));
    const moves = moving.map((it) => ({
      epicId: it.id,
      epicNumber: it.number,
      epicTitle: it.title,
      fromReleaseId: it.releaseId,
      alsoCovers: (others.get(it.id) ?? []).filter(
        (n) => n !== resource.number,
      ),
    }));
    return {
      moves,
      ask: moves.some(
        (it) => it.alsoCovers.length > 0 || it.fromReleaseId !== undefined,
      ),
    };
  }

  /**
   * Move epics into a release through Plan's own action, so the release's
   * cascade and refusals stay Plan's.
   */
  public async moveEpics(
    epicIds: number[],
    releaseId: number | null,
  ): Promise<void> {
    const controller = this.alepha.inject(EpicController);
    for (const id of epicIds) {
      await controller.updateEpic({ params: { id }, body: { releaseId } });
    }
  }

  /**
   * After a requirement gains or loses a covering epic: a stored by-hand
   * release pulls its first covering epics with no release into it; an epic
   * already in a release wins, and the stored value is cleared.
   */
  public async reconcile(requirementIds: number[]): Promise<void> {
    if (requirementIds.length === 0) return;
    const rows = await this.bound.collect(
      [...new Set(requirementIds)],
      (batch) =>
        this.requirements.findMany({ where: { id: { inArray: batch } } }),
    );
    const resources = await this.toResources(
      rows.filter((it) => it.targetReleaseId),
    );
    for (const resource of resources) {
      if (resource.coveringEpics.length === 0) continue;
      if (resource.coveringEpics.some((it) => it.releaseId)) {
        await this.requirements.updateById(resource.id, {
          targetReleaseId: null as never,
        });
        continue;
      }
      await this.moveEpics(
        resource.coveringEpics.map((it) => it.id),
        resource.targetReleaseId!,
      );
    }
  }

  /**
   * For each epic, the numbers of the requirements its use cases verify.
   */
  protected async requirementsCoveredBy(
    epicIds: number[],
  ): Promise<Map<number, number[]>> {
    const covers = await this.links.relationsFrom(
      "covers",
      "epic",
      epicIds.map(String),
      "usecase",
    );
    const useCaseIds = [...new Set(covers.map((it) => Number(it.toId)))];
    const criteria = await this.bound.collect(useCaseIds, (batch) =>
      this.criteria.findMany({
        where: {
          useCaseId: { inArray: batch },
          requirementId: { isNotNull: true },
        },
        columns: ["useCaseId", "requirementId"],
      }),
    );
    const requirementIds = [
      ...new Set(
        criteria.flatMap((it) => (it.requirementId ? [it.requirementId] : [])),
      ),
    ];
    const reqs = await this.bound.collect(requirementIds, (batch) =>
      this.requirements.findMany({
        where: { id: { inArray: batch } },
        columns: ["id", "number"],
      }),
    );
    const numberOf = new Map(reqs.map((it) => [it.id, it.number]));
    const result = new Map<number, number[]>();
    for (const cover of covers) {
      const epicId = Number(cover.fromId);
      const numbers = criteria
        .filter((c) => c.useCaseId === Number(cover.toId) && c.requirementId)
        .flatMap((c) =>
          numberOf.get(c.requirementId!)
            ? [numberOf.get(c.requirementId!)!]
            : [],
        );
      result.set(epicId, [
        ...new Set([...(result.get(epicId) ?? []), ...numbers]),
      ]);
    }
    return result;
  }

  /**
   * The requirements a use case's criteria verify.
   */
  public async requirementIdsOfUseCases(
    useCaseIds: number[],
  ): Promise<number[]> {
    if (useCaseIds.length === 0) return [];
    const rows = await this.bound.collect(useCaseIds, (batch) =>
      this.criteria.findMany({
        where: {
          useCaseId: { inArray: batch },
          requirementId: { isNotNull: true },
        },
        columns: ["requirementId"],
      }),
    );
    return [
      ...new Set(
        rows.flatMap((it) => (it.requirementId ? [it.requirementId] : [])),
      ),
    ];
  }
}
