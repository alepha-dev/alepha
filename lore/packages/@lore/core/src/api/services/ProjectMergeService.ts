import { $inject, AlephaError } from "alepha";
import { DatabaseProvider, type SQLLike } from "alepha/orm";

import { AutomationD1Provider } from "../providers/AutomationD1Provider.ts";
import { AutomationSqliteProvider } from "../providers/AutomationSqliteProvider.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";

/**
 * Moves everything a project holds into another one (#E94, folio #F1401),
 * so two projects that were split can become one again.
 *
 * Each module registers the step that moves its own tables, the way
 * `ProjectDeletionService` collects deletion steps: core cannot import a
 * feature module, and one hand-written list of tables is how a table added
 * later gets forgotten.
 *
 * The move is an UPDATE of `project_id`, never a copy: global ids stay, so
 * no foreign key between moved rows needs a rewrite. A per-project number
 * (`#Q12`, `#E3`) that is already taken in the target is the one thing that
 * changes, and every step reports what it renumbered so the caller can
 * publish the mapping.
 *
 * Every step plans first, reading the database and writing nothing; the
 * statements of every step then run as ONE atomic batch. D1 has no
 * transactions (#E69), and a merge half applied would leave two projects
 * that are each half of something.
 *
 * Deliberately not a permission check, for the reason `ProjectDeletionService`
 * gives: the caller gates first.
 */
export class ProjectMergeService {
  protected readonly database = $inject(DatabaseProvider);
  protected readonly automationDatabase = $inject(AutomationDatabase);
  protected readonly steps: ProjectMergeStep[] = [];

  /**
   * Register what a module moves when a project merges into another, in
   * `order`.
   */
  public registerStep(step: ProjectMergeStep): void {
    this.steps.push(step);
  }

  /**
   * Plans the merge of `sourceProjectId` into `targetProjectId`, then, unless
   * `dryRun`, applies it in one batch. Answers the plan either way: what
   * moved, what was renumbered, what was joined to a row the target already
   * had.
   */
  public async merge(
    sourceProjectId: number,
    targetProjectId: number,
    options: { dryRun?: boolean } = {},
  ): Promise<ProjectMergePlan> {
    if (sourceProjectId === targetProjectId) {
      throw new AlephaError("A project cannot be merged into itself");
    }
    // Plan and write on the primary: a read replica that has not seen the
    // last rows would plan a merge that leaves them behind.
    return this.automationDatabase.primary(async () => {
      await this.assertProject(sourceProjectId);
      await this.assertProject(targetProjectId);
      const context: ProjectMergeContext = { sourceProjectId, targetProjectId };
      const steps = [...this.steps].sort((a, b) => a.order - b.order);
      const plans: ProjectMergeStepPlan[] = [];
      for (const step of steps) {
        plans.push({ name: step.name, ...(await step.plan(context)) });
      }
      const dryRun = options.dryRun === true;
      if (!dryRun) {
        await this.apply(plans.flatMap((plan) => plan.statements));
      }
      return {
        sourceProjectId,
        targetProjectId,
        dryRun,
        steps: plans.map(({ statements: _, ...plan }) => plan),
      };
    });
  }

  /**
   * Refuses a project that does not exist or is deleted. The `projects`
   * table is read raw, so a soft-deleted project is visible here and
   * refused by name rather than reported as missing.
   */
  protected async assertProject(projectId: number): Promise<void> {
    const rows = await this.database.execute(
      `SELECT id, deleted_at FROM projects WHERE id = ${Number(projectId)}`,
    );
    if (!rows[0]) {
      throw new AlephaError(`No project ${projectId}`);
    }
    if (rows[0].deleted_at != null) {
      throw new AlephaError(`Project ${projectId} is deleted`);
    }
  }

  /**
   * Runs every statement as one atomic batch: D1's native batch, SQLite's
   * exclusive transaction, or a transaction on a driver that has one.
   */
  protected async apply(statements: SQLLike[]): Promise<void> {
    if (!statements.length) {
      return;
    }
    if (
      this.database instanceof AutomationD1Provider ||
      this.database instanceof AutomationSqliteProvider
    ) {
      await this.database.atomicBatch(statements);
      return;
    }
    if (!this.database.supportsTransactions) {
      throw new AlephaError(
        "This database has no atomic batch: a project merge cannot run on it",
      );
    }
    await this.database.transactional(async () => {
      for (const statement of statements) {
        await this.database.execute(statement);
      }
    });
  }
}

/**
 * The two projects a merge step works on.
 */
export interface ProjectMergeContext {
  sourceProjectId: number;
  targetProjectId: number;
}

/**
 * One module's part of a project merge.
 */
export interface ProjectMergeStep {
  order: number;
  /**
   * Names the step in the plan, `work` or `knowledge`.
   */
  name: string;
  /**
   * Reads both projects and answers what the step would do, with the
   * statements that do it. Writes nothing: the service runs the statements
   * of every step together, after every step has planned.
   */
  plan: (
    context: ProjectMergeContext,
  ) => Promise<Omit<ProjectMergeStepPlan, "name">>;
}

/**
 * What one step does, with the statements that do it.
 */
export interface ProjectMergeStepPlan {
  name: string;
  /**
   * Rows moved, per table.
   */
  moved: Record<string, number>;
  renumbered: ProjectMergeRenumber[];
  joined: ProjectMergeJoin[];
  changed: ProjectMergeChange[];
  statements: SQLLike[];
}

/**
 * A per-project number that was taken in the target, and the one the moved
 * item carries instead.
 */
export interface ProjectMergeRenumber {
  /**
   * `quest`, `epic`, `feedback`, `release`, ...
   */
  kind: string;
  id: number | string;
  from: number;
  to: number;
}

/**
 * A source row that was not moved but joined to the target's row of the
 * same key (a release by tag, an area by name): what pointed at it now
 * points at the target's row, and the source row is gone.
 */
export interface ProjectMergeJoin {
  kind: string;
  key: string;
  sourceId: number | string;
  targetId: number | string;
}

/**
 * A field of a moved item the merge had to change for it to fit in the
 * target, other than its number: a folio title suffixed because the target
 * has one by that name, a pin dropped because the target's pins fill the
 * budget.
 */
export interface ProjectMergeChange {
  kind: string;
  id: number | string;
  field: string;
  from: string;
  to: string;
}

/**
 * The answer of a merge, applied or not.
 */
export interface ProjectMergePlan {
  sourceProjectId: number;
  targetProjectId: number;
  dryRun: boolean;
  steps: Array<Omit<ProjectMergeStepPlan, "statements">>;
}
