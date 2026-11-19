import {
  BoundParameters,
  ProjectSecurityService,
  ResourceLinkService,
} from "@lore/core/api";
import { quests } from "@lore/plan/schemas";
import { RunErrorService } from "@lore/ship/api";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import {
  type UseCaseRunResult,
  useCaseRunResults,
} from "../entities/useCaseRunResults.ts";
import { type UseCaseRun, useCaseRuns } from "../entities/useCaseRuns.ts";
import type { UseCase } from "../entities/useCases.ts";
import type { CriterionResult } from "../schemas/criterionResultSchema.ts";
import type { RunBy } from "../schemas/runBySchema.ts";
import type { UseCaseRunState } from "../schemas/useCaseRunStateSchema.ts";

/**
 * A use case's latest run and what it says (#E153):
 *
 * - **state**: never run, passed, or a failure, which reads `in_development`
 *   while a quest covering the use case is open (the failure is expected)
 *   and `failed` once every one is done;
 * - **stale**: a covering quest was completed after the run, or the
 *   scenario version moved since. Computed, never stored;
 * - **errors**: a failed criterion opens an error only when every covering
 *   quest is done AND the project has Ship with `track`; one per criterion,
 *   resolved by a later pass.
 */
export class RunService {
  protected readonly runs = $repository(useCaseRuns);
  protected readonly results = $repository(useCaseRunResults);
  protected readonly criteria = $repository(useCaseCriteria);
  protected readonly quests = $repository(quests);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly errors = $inject(RunErrorService);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly bound = $inject(BoundParameters);

  /**
   * The latest run of each use case, with its results.
   */
  public async latestOf(
    useCaseIds: number[],
  ): Promise<Map<number, { run: UseCaseRun; results: UseCaseRunResult[] }>> {
    const latest = new Map<
      number,
      { run: UseCaseRun; results: UseCaseRunResult[] }
    >();
    if (useCaseIds.length === 0) return latest;
    // Batched under D1's bind limit (#Q3959); a use case's runs share a
    // batch, so "first seen" is still its latest.
    const runs = await this.bound.collect(useCaseIds, (batch) =>
      this.runs.findMany({
        where: { useCaseId: { inArray: batch } },
        orderBy: [{ column: "ranAt", direction: "desc" }],
      }),
    );
    for (const run of runs) {
      if (!latest.has(run.useCaseId))
        latest.set(run.useCaseId, { run, results: [] });
    }
    const runIds = [...latest.values()].map((it) => it.run.id);
    if (runIds.length) {
      const rows = await this.bound.collect(runIds, (batch) =>
        this.results.findMany({ where: { runId: { inArray: batch } } }),
      );
      for (const entry of latest.values()) {
        entry.results = rows.filter((it) => it.runId === entry.run.id);
      }
    }
    return latest;
  }

  /**
   * For each use case, whether every quest of its covering epics is done,
   * and when the last one was completed.
   */
  public async developmentOf(
    useCaseIds: number[],
  ): Promise<
    Map<number, { done: boolean; covered: boolean; lastCompletedAt?: string }>
  > {
    const result = new Map<
      number,
      { done: boolean; covered: boolean; lastCompletedAt?: string }
    >();
    if (useCaseIds.length === 0) return result;
    const covers = await this.links.relationsTo(
      "covers",
      "usecase",
      useCaseIds.map(String),
    );
    const epicIds = [...new Set(covers.map((it) => Number(it.fromId)))];
    const rows = await this.bound.collect(epicIds, (batch) =>
      this.quests.findMany({
        where: { epicId: { inArray: batch }, shelvedAt: { isNull: true } },
        columns: ["epicId", "completedAt"],
      }),
    );
    for (const id of useCaseIds) {
      const mine = new Set(
        covers
          .filter((it) => Number(it.toId) === id)
          .map((it) => Number(it.fromId)),
      );
      const own = rows.filter((it) => it.epicId && mine.has(it.epicId));
      const completed = own.flatMap((it) =>
        it.completedAt ? [it.completedAt] : [],
      );
      result.set(id, {
        covered: mine.size > 0,
        done: own.length > 0 && completed.length === own.length,
        lastCompletedAt: completed.sort().at(-1),
      });
    }
    return result;
  }

  /**
   * The state and staleness of a use case from its latest run.
   */
  public stateOf(
    useCase: Pick<UseCase, "scenarioVersion">,
    latest: { run: UseCaseRun; results: UseCaseRunResult[] } | undefined,
    development:
      | { done: boolean; covered: boolean; lastCompletedAt?: string }
      | undefined,
  ): { state: UseCaseRunState; stale: boolean } {
    if (!latest) return { state: "never_run", stale: false };
    const failed = latest.results.some((it) => it.result === "failed");
    const state: UseCaseRunState = !failed
      ? "passed"
      : development?.done
        ? "failed"
        : "in_development";
    const stale =
      latest.run.scenarioVersion < useCase.scenarioVersion ||
      (!!development?.lastCompletedAt &&
        development.lastCompletedAt > latest.run.ranAt);
    return { state, stale };
  }

  /**
   * Record a run, its results, and the errors they open or resolve.
   * Answers the run, its results, and how many errors were opened.
   */
  public async record(input: {
    useCase: UseCase;
    by: RunBy;
    client?: string;
    byUserId?: string;
    app?: string;
    env?: string;
    note?: string;
    results: Array<{ key: string; result: CriterionResult; note?: string }>;
  }): Promise<{
    run: UseCaseRun;
    results: UseCaseRunResult[];
    errorsOpened: number;
    errorRule: "opened" | "in_development" | "no_inbox" | "none";
  }> {
    const keys = new Set(
      (
        await this.criteria.findMany({
          where: { useCaseId: { eq: input.useCase.id } },
          columns: ["key"],
        })
      ).map((it) => it.key),
    );
    const given = new Map(
      input.results
        .filter((it) => keys.has(it.key.toUpperCase()))
        .map((it) => [it.key.toUpperCase(), it]),
    );
    const at = this.dt.nowISOString();
    const run = await this.runs.create({
      projectId: input.useCase.projectId,
      useCaseId: input.useCase.id,
      by: input.by,
      client: input.client,
      byUserId: input.byUserId,
      app: input.app,
      env: input.env,
      note: input.note,
      ranAt: at,
      scenarioVersion: input.useCase.scenarioVersion,
    });
    // Every criterion gets a row: one the run did not name was not run.
    const results = await this.results.createMany(
      [...keys].sort().map((key) => ({
        runId: run.id,
        criterionKey: key,
        result: given.get(key)?.result ?? ("not_run" as const),
        note: given.get(key)?.note,
      })),
    );

    const development = (await this.developmentOf([input.useCase.id])).get(
      input.useCase.id,
    );
    const capabilities = await this.security.capabilitiesOf(
      input.useCase.projectId,
    );
    const inbox = capabilities.ship?.track === true;
    const failing = results.filter((it) => it.result === "failed");
    let errorsOpened = 0;
    const errorRule = !failing.length
      ? ("none" as const)
      : !development?.done
        ? ("in_development" as const)
        : !inbox
          ? ("no_inbox" as const)
          : ("opened" as const);
    if (inbox) {
      for (const result of results) {
        if (result.result === "failed" && development?.done) {
          await this.errors.failed({
            projectId: input.useCase.projectId,
            useCaseId: input.useCase.id,
            useCaseRunId: run.id,
            criterionKey: result.criterionKey,
            name: `#U${input.useCase.number} ${result.criterionKey} failed`,
            message: `${input.useCase.title}: ${result.criterionKey} failed${result.note ? `: ${result.note}` : ""}`,
            stack: [
              `Use case: #U${input.useCase.number} ${input.useCase.title}`,
              `Criterion: ${result.criterionKey}`,
              `Run: ${run.id} by ${input.by}${input.client ? ` (${input.client})` : ""} on ${input.app ?? "local"}${input.env ? `/${input.env}` : ""}`,
            ].join("\n"),
            at,
          });
          errorsOpened++;
        }
        if (result.result === "passed") {
          await this.errors.passed({
            projectId: input.useCase.projectId,
            useCaseId: input.useCase.id,
            criterionKey: result.criterionKey,
            at,
          });
        }
      }
    }
    return { run, results, errorsOpened, errorRule };
  }
}
