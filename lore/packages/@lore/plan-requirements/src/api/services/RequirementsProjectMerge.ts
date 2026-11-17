import {
  type ProjectMergeContext,
  ProjectMergeNumbers,
  ProjectMergeReferences,
  type ProjectMergeRewriter,
  ProjectMergeService,
  type ProjectMergeStepPlan,
  projectMergeWrite,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository, type SQLLike } from "alepha/orm";

import { personas } from "../entities/personas.ts";
import { requirementMetricDays } from "../entities/requirementMetricDays.ts";
import { requirements } from "../entities/requirements.ts";
import { requirementsComments } from "../entities/requirementsComments.ts";
import { useCaseRuns } from "../entities/useCaseRuns.ts";
import { useCases } from "../entities/useCases.ts";

/**
 * Requirements' step of a project merge (#E153), registered on core's
 * `ProjectMergeService` after Plan's, Remember's and Ship's: personas move
 * and use cases move into the target project, renumbered on a collision,
 * with their comments; the `#A` and `#U` references in every moved body
 * follow the new numbers.
 */
export class RequirementsProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly numbers = $inject(ProjectMergeNumbers);
  protected readonly references = $inject(ProjectMergeReferences);
  protected readonly personas = $repository(personas);
  protected readonly comments = $repository(requirementsComments);
  protected readonly useCases = $repository(useCases);
  protected readonly requirements = $repository(requirements);
  protected readonly runs = $repository(useCaseRuns);
  protected readonly metricDays = $repository(requirementMetricDays);

  constructor() {
    this.merge.registerStep({
      order: 40,
      name: "requirements",
      // Steps, alternatives, criteria and actors hang off a use case by its
      // id, which does not change, so they follow it.
      // A requirement's target release (a by-hand value) names a release of
      // the source project, which Plan's step joins or moves by its id.
      tables: [
        "personas",
        "use_cases",
        "requirements",
        "requirements_comments",
        "use_case_runs",
        "requirement_metric_days",
      ],
      plan: (context) => this.plan(context),
      rewrite: (context, rewriter) => this.rewrite(context, rewriter),
    });
  }

  protected async plan(
    context: ProjectMergeContext,
  ): Promise<Omit<ProjectMergeStepPlan, "name">> {
    const kinds = [
      {
        kind: "persona",
        repository: this.personas,
        sequence: "personaNumber",
        table: "personas",
      },
      {
        kind: "usecase",
        repository: this.useCases,
        sequence: "useCaseNumber",
        table: "use_cases",
      },
      {
        kind: "requirement",
        repository: this.requirements,
        sequence: "requirementNumber",
        table: "requirements",
      },
    ] as const;
    const plan = {
      moved: {},
      renumbered: [],
      joined: [],
      changed: [],
      statements: [],
      sequences: [],
    } satisfies Omit<ProjectMergeStepPlan, "name"> as {
      moved: Record<string, number>;
      renumbered: ProjectMergeStepPlan["renumbered"];
      joined: ProjectMergeStepPlan["joined"];
      changed: ProjectMergeStepPlan["changed"];
      statements: SQLLike[];
      sequences: NonNullable<ProjectMergeStepPlan["sequences"]>;
    };
    for (const it of kinds) {
      const read = async (projectId: number) =>
        (
          await (it.repository as typeof this.personas).findMany(
            {
              where: { projectId: { eq: projectId } },
              columns: ["id", "number"],
              orderBy: [{ column: "id", direction: "asc" }],
            },
            { force: true },
          )
        ).map((row) => ({ id: row.id, number: row.number }));
      const source = await read(context.sourceProjectId);
      const target = await read(context.targetProjectId);
      const numbering = await this.numbers.renumber({
        kind: it.kind,
        repository: it.repository as never,
        field: "number",
        sequence: it.sequence,
        targetProjectId: context.targetProjectId,
        targetNumbers: target.map((row) => row.number),
        sourceRows: source,
      });
      plan.moved[it.table] = source.length;
      plan.renumbered.push(...numbering.renumbered);
      plan.sequences.push(...numbering.sequences);
      plan.statements.push(
        ...numbering.statements,
        (it.repository as typeof this.personas).updateStatement(
          { projectId: { eq: context.sourceProjectId } },
          { projectId: context.targetProjectId },
          projectMergeWrite,
        ),
      );
    }
    plan.moved.use_case_runs = await this.runs.count({
      projectId: { eq: context.sourceProjectId },
    });
    plan.statements.push(
      this.runs.updateStatement(
        { projectId: { eq: context.sourceProjectId } },
        { projectId: context.targetProjectId },
        projectMergeWrite,
      ),
    );
    plan.moved.requirement_metric_days = await this.metricDays.count({
      projectId: { eq: context.sourceProjectId },
    });
    plan.statements.push(
      this.metricDays.updateStatement(
        { projectId: { eq: context.sourceProjectId } },
        { projectId: context.targetProjectId },
        projectMergeWrite,
      ),
    );
    plan.moved.requirements_comments = await this.comments.count({
      projectId: { eq: context.sourceProjectId },
    });
    plan.statements.push(
      this.comments.updateStatement(
        { projectId: { eq: context.sourceProjectId } },
        { projectId: context.targetProjectId },
        projectMergeWrite,
      ),
    );
    return plan;
  }

  /**
   * The bodies a reference can live in: a persona's three texts and every
   * comment of the source project.
   */
  protected async rewrite(
    context: ProjectMergeContext,
    rewriter: ProjectMergeRewriter,
  ): Promise<{ rewritten: Record<string, number>; statements: SQLLike[] }> {
    const where = { projectId: { eq: context.sourceProjectId } };
    const people = await this.references.rewrite(rewriter, {
      repository: this.personas,
      fields: ["who", "goals", "frustrations"],
      where,
    });
    const scenarios = await this.references.rewrite(rewriter, {
      repository: this.useCases,
      fields: ["preconditions"],
      where,
    });
    const threads = await this.references.rewrite(rewriter, {
      repository: this.comments,
      fields: ["body"],
      where,
    });
    return {
      rewritten: {
        personas: people.rewritten,
        use_cases: scenarios.rewritten,
        requirements_comments: threads.rewritten,
      },
      statements: [
        ...people.statements,
        ...scenarios.statements,
        ...threads.statements,
      ],
    };
  }
}
