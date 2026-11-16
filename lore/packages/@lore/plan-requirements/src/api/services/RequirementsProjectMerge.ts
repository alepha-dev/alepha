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
import { requirementsComments } from "../entities/requirementsComments.ts";

/**
 * Requirements' step of a project merge (#E153), registered on core's
 * `ProjectMergeService` after Plan's, Remember's and Ship's: personas move
 * into the target project, renumbered on a collision, with their comments;
 * the `#A` references in every moved body follow the new numbers.
 */
export class RequirementsProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly numbers = $inject(ProjectMergeNumbers);
  protected readonly references = $inject(ProjectMergeReferences);
  protected readonly personas = $repository(personas);
  protected readonly comments = $repository(requirementsComments);

  constructor() {
    this.merge.registerStep({
      order: 40,
      name: "requirements",
      tables: ["personas", "requirements_comments"],
      plan: (context) => this.plan(context),
      rewrite: (context, rewriter) => this.rewrite(context, rewriter),
    });
  }

  protected async plan(
    context: ProjectMergeContext,
  ): Promise<Omit<ProjectMergeStepPlan, "name">> {
    const read = async (projectId: number) =>
      (
        await this.personas.findMany(
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
      kind: "persona",
      repository: this.personas as never,
      field: "number",
      sequence: "personaNumber",
      targetProjectId: context.targetProjectId,
      targetNumbers: target.map((row) => row.number),
      sourceRows: source,
    });
    const comments = await this.comments.count({
      projectId: { eq: context.sourceProjectId },
    });
    const statements: SQLLike[] = [
      ...numbering.statements,
      this.personas.updateStatement(
        { projectId: { eq: context.sourceProjectId } },
        { projectId: context.targetProjectId },
        projectMergeWrite,
      ),
      this.comments.updateStatement(
        { projectId: { eq: context.sourceProjectId } },
        { projectId: context.targetProjectId },
        projectMergeWrite,
      ),
    ];
    return {
      moved: { personas: source.length, requirements_comments: comments },
      renumbered: numbering.renumbered,
      joined: [],
      changed: [],
      statements,
      sequences: numbering.sequences,
    };
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
    const threads = await this.references.rewrite(rewriter, {
      repository: this.comments,
      fields: ["body"],
      where,
    });
    return {
      rewritten: {
        personas: people.rewritten,
        requirements_comments: threads.rewritten,
      },
      statements: [...people.statements, ...threads.statements],
    };
  }
}
