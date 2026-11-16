import {
  BestEffort,
  ResourceLinkService,
  ResourceRegistry,
} from "@lore/core/api";
import { EpicProgressService } from "@lore/plan/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { personas } from "../entities/personas.ts";
import { useCaseActors } from "../entities/useCaseActors.ts";
import { useCaseAlternatives } from "../entities/useCaseAlternatives.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { type UseCase, useCases } from "../entities/useCases.ts";
import { useCaseSteps } from "../entities/useCaseSteps.ts";
import type { UseCaseInput } from "../schemas/useCaseInputSchema.ts";
import type { UseCaseResource } from "../schemas/useCaseResourceSchema.ts";

/**
 * The scenario of a use case (#E153): its actors, steps, alternatives and
 * criteria, written in a safe order with no transaction (D1).
 *
 * - The package's own tables are the truth and are written first; the
 *   `actor` mirror rows follow, through `BestEffort`, rewritten on every
 *   save so a lost one heals.
 * - A criterion keeps its key; a new one takes `criterionSeq + 1`, so a key
 *   is never reused.
 * - Any change to a step or a criterion bumps `scenarioVersion`, and moves a
 *   validated use case back to ready.
 */
export class UseCaseService {
  protected readonly useCases = $repository(useCases);
  protected readonly steps = $repository(useCaseSteps);
  protected readonly alternatives = $repository(useCaseAlternatives);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly actors = $repository(useCaseActors);
  protected readonly personas = $repository(personas);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly epicProgress = $inject(EpicProgressService);

  /**
   * Write the lists `input` carries onto `useCase`, then its mirrors.
   * Answers the row as it stands after the write.
   */
  public async writeScenario(
    useCase: UseCase,
    input: UseCaseInput,
    options: { created?: boolean } = {},
  ): Promise<UseCase> {
    let changed = false;
    let seq = useCase.criterionSeq;

    if (input.actors) {
      await this.assertPersonas(
        useCase.projectId,
        input.actors.map((it) => it.personaId),
      );
      if (!options.created) {
        await this.actors.deleteMany({ useCaseId: { eq: useCase.id } });
      }
      const unique = new Map(input.actors.map((it) => [it.personaId, it]));
      if (unique.size) {
        await this.actors.createMany(
          [...unique.values()].map((it) => ({
            useCaseId: useCase.id,
            personaId: it.personaId,
            role: it.role ?? "primary",
          })),
        );
      }
    }

    if (input.steps) {
      const before = options.created ? [] : await this.stepsOf(useCase.id);
      const next = input.steps.map((it, index) => ({
        position: index + 1,
        actorPersonaId: it.actorPersonaId,
        text: it.text,
      }));
      if (
        JSON.stringify(this.comparableSteps(before)) !== JSON.stringify(next)
      ) {
        changed = true;
        if (!options.created) {
          await this.steps.deleteMany({ useCaseId: { eq: useCase.id } });
        }
        if (next.length) {
          await this.steps.createMany(
            next.map((it) => ({ ...it, useCaseId: useCase.id })),
          );
        }
      }
    }

    if (input.alternatives) {
      if (!options.created) {
        await this.alternatives.deleteMany({ useCaseId: { eq: useCase.id } });
      }
      if (input.alternatives.length) {
        await this.alternatives.createMany(
          input.alternatives.map((it, index) => ({
            useCaseId: useCase.id,
            key: it.key,
            text: it.text,
            position: index + 1,
          })),
        );
      }
    }

    if (input.criteria) {
      const before = options.created ? [] : await this.criteriaOf(useCase.id);
      const known = new Map(before.map((it) => [it.key, it]));
      const next = input.criteria.map((it, index) => {
        // Only a key this use case holds is kept: a freed one (a deleted
        // criterion) or one never handed out takes the next number.
        const key = it.key && known.has(it.key) ? it.key : `C${++seq}`;
        return {
          key,
          position: index + 1,
          givenText: it.givenText,
          whenText: it.whenText,
          thenText: it.thenText,
          text: it.text,
          method: it.method ?? "manual",
          alternativeKey: it.alternativeKey,
          requirementId: known.get(key)?.requirementId,
        };
      });
      if (
        JSON.stringify(this.comparableCriteria(before)) !==
        JSON.stringify(this.comparableCriteria(next))
      ) {
        changed = true;
        if (!options.created) {
          await this.criteria.deleteMany({ useCaseId: { eq: useCase.id } });
        }
        if (next.length) {
          await this.criteria.createMany(
            next.map((it) => ({ ...it, useCaseId: useCase.id })),
          );
        }
      }
    }

    let row = useCase;
    if (seq !== useCase.criterionSeq || (changed && !options.created)) {
      row = await this.useCases.updateById(useCase.id, {
        criterionSeq: seq,
        ...(changed && !options.created
          ? {
              scenarioVersion: useCase.scenarioVersion + 1,
              ...(useCase.status === "validated"
                ? { status: "ready" as const }
                : {}),
            }
          : {}),
      });
    }

    await this.bestEffort.run("use case: actor mirror", () =>
      this.mirrorActors(row.id),
    );
    return row;
  }

  /**
   * The `actor` link rows of one use case, from `use_case_actors`.
   */
  public async mirrorActors(useCaseId: number): Promise<void> {
    const rows = await this.actors.findMany({
      where: { useCaseId: { eq: useCaseId } },
      columns: ["personaId"],
    });
    await this.links.mirrorInbound(
      "actor",
      { kind: "usecase", id: useCaseId },
      "persona",
      rows.map((it) => it.personaId),
    );
  }

  /**
   * The epics covering each use case: `covers` rows of the link graph.
   */
  public async coveringEpics(
    projectId: number,
    useCaseIds: number[],
  ): Promise<Map<number, UseCaseResource["coveredBy"]>> {
    const byUseCase = new Map<number, UseCaseResource["coveredBy"]>();
    if (useCaseIds.length === 0) return byUseCase;
    const rows = await this.links.relationsTo(
      "covers",
      "usecase",
      useCaseIds.map(String),
    );
    const epicIds = [...new Set(rows.map((it) => it.fromId))];
    const [described, progress] = await Promise.all([
      this.resources.describe("epic", projectId, epicIds),
      this.epicProgress.computeProgressOfProject(projectId),
    ]);
    const epics = new Map(described.map((it) => [it.id, it]));
    for (const row of rows) {
      const epic = epics.get(row.fromId);
      if (!epic) continue;
      const list = byUseCase.get(Number(row.toId)) ?? [];
      list.push({
        id: Number(epic.id),
        number: epic.shortId,
        title: epic.title,
        status: epic.status,
        progress: {
          completed: progress.get(Number(epic.id))?.completed ?? 0,
          total: progress.get(Number(epic.id))?.total ?? 0,
        },
      });
      byUseCase.set(Number(row.toId), list);
    }
    return byUseCase;
  }

  /**
   * Every use case of `rows` as a resource, in four reads whatever their
   * number.
   */
  public async toResources(rows: UseCase[]): Promise<UseCaseResource[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((it) => it.id);
    const [actors, steps, alternatives, criteria, covered] = await Promise.all([
      this.actors.findMany({ where: { useCaseId: { inArray: ids } } }),
      this.steps.findMany({
        where: { useCaseId: { inArray: ids } },
        orderBy: [{ column: "position", direction: "asc" }],
      }),
      this.alternatives.findMany({
        where: { useCaseId: { inArray: ids } },
        orderBy: [{ column: "position", direction: "asc" }],
      }),
      this.criteria.findMany({
        where: { useCaseId: { inArray: ids } },
        orderBy: [{ column: "position", direction: "asc" }],
      }),
      this.coveringEpics(rows[0].projectId, ids),
    ]);
    const people = actors.length
      ? await this.personas.findMany(
          {
            where: {
              id: { inArray: [...new Set(actors.map((it) => it.personaId))] },
            },
            columns: ["id", "number", "name"],
          },
          { force: true },
        )
      : [];
    const person = new Map(people.map((it) => [it.id, it]));
    return rows.map((row) => {
      const { deletedAt: _deleted, ...rest } = row;
      return {
        ...rest,
        actors: actors
          .filter((it) => it.useCaseId === row.id)
          .flatMap((it) => {
            const p = person.get(it.personaId);
            return p
              ? [
                  {
                    personaId: it.personaId,
                    role: it.role,
                    number: p.number,
                    name: p.name,
                  },
                ]
              : [];
          }),
        steps: steps
          .filter((it) => it.useCaseId === row.id)
          .map((it) => ({
            id: it.id,
            position: it.position,
            actorPersonaId: it.actorPersonaId,
            text: it.text,
          })),
        alternatives: alternatives
          .filter((it) => it.useCaseId === row.id)
          .map((it) => ({ id: it.id, key: it.key, text: it.text })),
        criteria: criteria
          .filter((it) => it.useCaseId === row.id)
          .map(({ useCaseId: _useCase, ...it }) => it),
        coveredBy: covered.get(row.id) ?? [],
      };
    });
  }

  protected async stepsOf(useCaseId: number) {
    return await this.steps.findMany({
      where: { useCaseId: { eq: useCaseId } },
      orderBy: [{ column: "position", direction: "asc" }],
    });
  }

  protected async criteriaOf(useCaseId: number) {
    return await this.criteria.findMany({
      where: { useCaseId: { eq: useCaseId } },
      orderBy: [{ column: "position", direction: "asc" }],
    });
  }

  protected comparableSteps(
    rows: Array<{ position: number; actorPersonaId?: number; text: string }>,
  ) {
    return rows.map((it) => ({
      position: it.position,
      actorPersonaId: it.actorPersonaId,
      text: it.text,
    }));
  }

  protected comparableCriteria(
    rows: Array<{
      key: string;
      givenText?: string;
      whenText?: string;
      thenText?: string;
      text?: string;
      method: string;
      alternativeKey?: string;
    }>,
  ) {
    return rows.map((it) => [
      it.key,
      it.givenText ?? "",
      it.whenText ?? "",
      it.thenText ?? "",
      it.text ?? "",
      it.method,
      it.alternativeKey ?? "",
    ]);
  }

  /**
   * Every actor is a live persona of the project.
   */
  protected async assertPersonas(
    projectId: number,
    ids: number[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.personas.findMany({
      where: {
        projectId: { eq: projectId },
        id: { inArray: [...new Set(ids)] },
      },
      columns: ["id"],
    });
    if (found.length !== new Set(ids).size) {
      throw new BadRequestError("An actor is not a persona of this project");
    }
  }
}
