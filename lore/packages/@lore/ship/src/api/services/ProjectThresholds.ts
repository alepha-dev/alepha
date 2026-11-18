import {
  BatchRepository,
  GuardedBatch,
  HourlyChecks,
  ProjectEvents,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";
import {
  type ProjectThreshold,
  projectThresholds,
} from "../entities/projectThresholds.ts";
import { ShipProjectEvents } from "./ShipProjectEvents.ts";

/**
 * The coverage and open-errors thresholds (#Q3894): two alerts, each checked
 * where its number is cheap to read, and recorded as ordinary events.
 *
 * - **Coverage** when a push on `main` arrives: under the threshold records
 *   `coverage.dropped`.
 * - **Open errors** by the hourly job: one count for the projects that set a
 *   threshold, over it records `errors.threshold_crossed`. The error ingest
 *   path is not touched.
 * - **Edge-triggered**: the event is written in a guarded batch that also
 *   disarms the alert, conditioned on it being armed, so two pushes or two
 *   ticks alert once; coming back to the right side rearms it.
 */
export class ProjectThresholds {
  /**
   * The branch coverage is read on: `QualityController` reads `main` as a
   * literal, and there is no default-branch setting.
   */
  public static readonly BRANCH = "main";

  protected readonly rows = $inject(BatchRepository.of(projectThresholds));
  protected readonly errors = $repository(projectErrors);
  protected readonly projects = $repository(projects);
  protected readonly batch = $inject(GuardedBatch);
  protected readonly events = $inject(ProjectEvents);
  protected readonly definitions = $inject(ShipProjectEvents);
  protected readonly checks = $inject(HourlyChecks);

  constructor() {
    this.checks.register({
      name: "errors.threshold",
      run: async () => {
        await this.checkErrors();
      },
    });
  }

  public async get(projectId: number): Promise<ProjectThreshold | undefined> {
    return (await this.rows.findOne({ where: { projectId } })) ?? undefined;
  }

  /**
   * Sets or clears (`null`) either threshold. A changed threshold rearms
   * its alert.
   */
  public async set(
    projectId: number,
    input: { coverageMin?: number | null; openErrorsMax?: number | null },
  ): Promise<ProjectThreshold> {
    const patch: Record<string, unknown> = {};
    if (input.coverageMin !== undefined) {
      patch.coverageMin = input.coverageMin;
      patch.coverageArmed = true;
    }
    if (input.openErrorsMax !== undefined) {
      patch.openErrorsMax = input.openErrorsMax;
      patch.errorsArmed = true;
    }
    const existing = await this.get(projectId);
    if (existing) return this.rows.updateById(existing.id, patch as never);
    return this.rows.create({ projectId, ...patch } as never);
  }

  /**
   * A coverage push arrived. `previous` is the line coverage `main` had
   * before it. Answers whether `coverage.dropped` was recorded.
   */
  public async onCoverage(
    projectId: number,
    run: { branch: string; commitSha: string; lines: number },
    previous: number | undefined,
  ): Promise<boolean> {
    if (run.branch !== ProjectThresholds.BRANCH) return false;
    const row = await this.get(projectId);
    if (row?.coverageMin === undefined || row.coverageMin === null)
      return false;
    if (run.lines >= row.coverageMin) {
      if (row.coverageArmed === false)
        await this.rows.updateById(row.id, { coverageArmed: true });
      return false;
    }
    if (row.coverageArmed === false) return false;
    const project = await this.projects.getById(projectId);
    return this.fire(
      row,
      "coverageArmed",
      await this.events.emit({
        projectId,
        name: "coverage.dropped",
        subjectId: run.commitSha,
        fields: {
          project: project.title,
          title: project.title,
          value: run.lines,
          previous: previous ?? null,
          threshold: row.coverageMin,
          branch: run.branch,
          commit: run.commitSha,
          url: `/${project.slug || `project-${project.id}`}/quality`,
        },
      }),
    );
  }

  /**
   * The hourly check: one read of the projects that set an open-errors
   * threshold, each with its open count.
   */
  public async checkErrors(): Promise<number> {
    const rows = await this.rows.findMany({
      where: { openErrorsMax: { isNotNull: true } },
      limit: 1000,
    });
    let fired = 0;
    for (const row of rows) {
      const open = await this.errors.count({
        projectId: row.projectId,
        status: "open",
      });
      if (open <= row.openErrorsMax!) {
        if (row.errorsArmed === false)
          await this.rows.updateById(row.id, { errorsArmed: true });
        continue;
      }
      if (row.errorsArmed === false) continue;
      const project = await this.projects.getById(row.projectId);
      if (
        await this.fire(
          row,
          "errorsArmed",
          await this.events.emit({
            projectId: row.projectId,
            name: "errors.threshold_crossed",
            subjectId: row.projectId,
            fields: {
              project: project.title,
              title: project.title,
              count: open,
              threshold: row.openErrorsMax!,
              url: `/${project.slug || `project-${project.id}`}/errors`,
            },
          }),
        )
      )
        fired++;
    }
    return fired;
  }

  /**
   * Records the event and disarms the alert, together, only if it is still
   * armed: a second push or tick finds it disarmed and records nothing.
   */
  protected async fire(
    row: ProjectThreshold,
    armed: "coverageArmed" | "errorsArmed",
    recorded: Awaited<ReturnType<ProjectEvents["emit"]>>,
  ): Promise<boolean> {
    const condition = sql`EXISTS ${this.rows.subquery({
      id: row.id,
      or: [{ [armed]: { isNull: true } }, { [armed]: true }],
    } as never)}`;
    try {
      await this.batch.guarded(condition, [
        this.rows.updateStatement({ id: row.id }, { [armed]: false } as never, {
          returning: false,
        }),
        ...recorded.statements,
      ]);
    } catch {
      return false;
    }
    await recorded.committed();
    return true;
  }
}
