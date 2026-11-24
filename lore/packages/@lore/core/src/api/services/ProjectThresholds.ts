import { $inject } from "alepha";
import { sql } from "alepha/orm";

import {
  type ProjectThreshold,
  projectThresholds,
} from "../entities/projectThresholds.ts";
import { BatchRepository } from "./BatchRepository.ts";
import { GuardedBatch } from "./GuardedBatch.ts";
import type { ProjectEvents } from "./ProjectEvents.ts";

/**
 * A project's alert thresholds (#Q3894), the table and how an alert fires:
 * the coverage one is core's Quality (#Q4217) and the open-errors one Ship's,
 * so the row is core's and each side checks its own.
 *
 * - **Coverage** when a push on `main` arrives (`CoverageThreshold`): under
 *   the threshold records `coverage.dropped`.
 * - **Open errors** by the hourly job (`ErrorThreshold`, in `@lore/ship`):
 *   over it records `errors.threshold_crossed`. The error ingest path is not
 *   touched.
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
  protected readonly batch = $inject(GuardedBatch);

  public async get(projectId: number): Promise<ProjectThreshold | undefined> {
    return (await this.rows.findOne({ where: { projectId } })) ?? undefined;
  }

  /**
   * Every row that sets the open-errors threshold, for the hourly check.
   */
  public async withOpenErrorsMax(): Promise<ProjectThreshold[]> {
    return this.rows.findMany({
      where: { openErrorsMax: { isNotNull: true } },
      limit: 1000,
    });
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
   * The value is back on the right side: rearm the alert if it was
   * disarmed.
   */
  public async rearm(row: ProjectThreshold, armed: ThresholdArmed) {
    if (row[armed] === false) {
      await this.rows.updateById(row.id, { [armed]: true } as never);
    }
  }

  /**
   * Records the event and disarms the alert, together, only if it is still
   * armed: a second push or tick finds it disarmed and records nothing.
   */
  public async fire(
    row: ProjectThreshold,
    armed: ThresholdArmed,
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

/**
 * Which alert of a threshold row a check fires or rearms.
 */
export type ThresholdArmed = "coverageArmed" | "errorsArmed";
