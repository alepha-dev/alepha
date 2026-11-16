import { ResourceLinkService } from "@lore/core/api";
import { EpicController } from "@lore/plan/api";
import { compareReleaseTags, epics, releases } from "@lore/plan/schemas";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";

import { personas } from "../entities/personas.ts";
import { type Requirement, requirements } from "../entities/requirements.ts";
import { useCaseActors } from "../entities/useCaseActors.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import type { ReleaseMove } from "../schemas/releaseMoveSchema.ts";
import type { RequirementResource } from "../schemas/requirementResourceSchema.ts";

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

  /**
   * Every requirement of `rows` as a resource, in a fixed number of reads.
   */
  public async toResources(
    rows: Requirement[],
  ): Promise<RequirementResource[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((it) => it.id);
    const criteria = await this.criteria.findMany({
      where: { requirementId: { inArray: ids } },
      orderBy: [{ column: "key", direction: "asc" }],
    });
    const useCaseIds = [...new Set(criteria.map((it) => it.useCaseId))];
    const [cases, actors, covers] = await Promise.all([
      useCaseIds.length
        ? this.useCases.findMany({
            where: { id: { inArray: useCaseIds } },
            columns: ["id", "number", "title"],
          })
        : [],
      useCaseIds.length
        ? this.actors.findMany({
            where: { useCaseId: { inArray: useCaseIds } },
          })
        : [],
      this.links.relationsTo("covers", "usecase", useCaseIds.map(String)),
    ]);
    const epicIds = [...new Set(covers.map((it) => Number(it.fromId)))];
    const personaIds = [...new Set(actors.map((it) => it.personaId))];
    const [epicRows, people] = await Promise.all([
      epicIds.length
        ? this.epics.findMany({
            where: { id: { inArray: epicIds } },
            columns: ["id", "number", "title", "releaseId"],
          })
        : [],
      personaIds.length
        ? this.personas.findMany({
            where: { id: { inArray: personaIds } },
            columns: ["id", "number", "name"],
          })
        : [],
    ]);
    const releaseIds = [
      ...new Set([
        ...epicRows.flatMap((it) => (it.releaseId ? [it.releaseId] : [])),
        ...rows.flatMap((it) =>
          it.targetReleaseId ? [it.targetReleaseId] : [],
        ),
      ]),
    ];
    const releaseRows = releaseIds.length
      ? await this.releases.findMany({
          where: { id: { inArray: releaseIds } },
          columns: ["id", "number", "tag", "title"],
        })
      : [];
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
        // Until runs exist, a requirement is covered when a criterion
        // verifies it; the runs quest reads the latest results.
        status: mine.length ? ("covered" as const) : ("not_covered" as const),
      };
    });
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
    const rows = await this.requirements.findMany({
      where: { id: { inArray: [...new Set(requirementIds)] } },
    });
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
    const criteria = useCaseIds.length
      ? await this.criteria.findMany({
          where: {
            useCaseId: { inArray: useCaseIds },
            requirementId: { isNotNull: true },
          },
          columns: ["useCaseId", "requirementId"],
        })
      : [];
    const requirementIds = [
      ...new Set(
        criteria.flatMap((it) => (it.requirementId ? [it.requirementId] : [])),
      ),
    ];
    const reqs = requirementIds.length
      ? await this.requirements.findMany({
          where: { id: { inArray: requirementIds } },
          columns: ["id", "number"],
        })
      : [];
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
    const rows = await this.criteria.findMany({
      where: {
        useCaseId: { inArray: useCaseIds },
        requirementId: { isNotNull: true },
      },
      columns: ["requirementId"],
    });
    return [
      ...new Set(
        rows.flatMap((it) => (it.requirementId ? [it.requirementId] : [])),
      ),
    ];
  }
}
