import { ResourceRegistry } from "@lore/core/api";
import { ProjectTools } from "@lore/core/mcp";
import { ReleaseController } from "@lore/plan/api";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { NotFoundError } from "alepha/server";

import { RequirementController } from "../../api/controllers/RequirementController.ts";
import type { RequirementInput } from "../../api/schemas/requirementInputSchema.ts";
import {
  criterionVerifyLinkParamsSchema,
  criterionVerifyLinkResultSchema,
  requirementCreateParamsSchema,
  requirementDeleteParamsSchema,
  requirementDeleteResultSchema,
  type RequirementFields,
  requirementGetParamsSchema,
  requirementGetResultSchema,
  requirementListParamsSchema,
  requirementListResultSchema,
  requirementSetReleaseParamsSchema,
  requirementSetReleaseResultSchema,
  requirementUpdateParamsSchema,
  requirementWriteResultSchema,
} from "../schemas/requirementSchemas.ts";

/**
 * The requirement tools of Plan's Requirements (#E153), each with its
 * `lore requirement` command, plus `criterion_verify_link`, which ties a
 * use case's criterion to the requirement it verifies.
 */
export class RequirementTools {
  protected readonly requirements = $inject(RequirementController);
  protected readonly releaseController = $inject(ReleaseController);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly projectTools = $inject(ProjectTools);

  protected async projectId(project?: number, name?: string): Promise<number> {
    return await this.projectTools.resolveProjectId(project, name);
  }

  /**
   * The fields in the action's shape, a folio number turned into its id.
   */
  protected async inputOf(
    projectId: number,
    fields: RequirementFields,
  ): Promise<RequirementInput> {
    const { source_folio_shortId, ...rest } = fields;
    if (source_folio_shortId === undefined) return rest;
    const ids = await this.resources
      .get("folio")
      ?.resolveNumbers?.(projectId, [source_folio_shortId]);
    const folioId = ids?.get(source_folio_shortId);
    if (!folioId)
      throw new NotFoundError(`Folio #F${source_folio_shortId} not found`);
    return { ...rest, sourceFolioId: folioId };
  }

  requirement_list = $tool({
    description:
      "List the requirements of a project (#S15 and so on): the specification's lines with their type, MoSCoW priority, chapter and paragraph, computed status, the criteria verifying each (`#U7 C2`) and the release it ships in.",
    title: "List requirements",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: requirementListParamsSchema,
      result: requirementListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const rows = await this.requirements.getRequirements({
        params: { projectId },
        query: {
          ...(params.type ? { type: params.type } : {}),
          ...(params.priority ? { priority: params.priority } : {}),
        },
      });
      return {
        requirements: rows.map((it) => ({
          id: it.id,
          number: it.number,
          statement: it.statement,
          type: it.type,
          priority: it.priority,
          chapter: it.chapter,
          paragraph: it.paragraph,
          status: it.status,
          verifiedBy: it.criteria.map((c) => `#U${c.useCaseNumber} ${c.key}`),
          release: it.targetRelease
            ? `${it.targetRelease.tag ?? it.targetRelease.number} (${it.targetRelease.mode === "auto" ? "auto" : "by hand"})`
            : undefined,
        })),
      };
    },
  });

  requirement_get = $tool({
    description:
      "Fetch one requirement by its number (15 for #S15): statement, description, type, priority, source, the criteria verifying it, the epics covering it, the personas concerned, its target release (auto from the epics, or by hand) and its status.",
    title: "Get requirement",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: requirementGetParamsSchema,
      result: requirementGetResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      return await this.requirements.getRequirementByNumber({
        params: { projectId, number: params.number },
      });
    },
  });

  requirement_create = $tool({
    description:
      "Create a requirement, a line of the specification, numbered #S<n>. Tie it to the criteria that verify it with criterion_verify_link.",
    title: "Create requirement",
    schema: {
      params: requirementCreateParamsSchema,
      result: requirementWriteResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, ...fields } = params;
      const projectId = await this.projectId(project, project_name);
      return await this.requirements.createRequirement({
        params: { projectId },
        body: {
          ...(await this.inputOf(projectId, fields)),
          statement: fields.statement,
        },
      });
    },
  });

  requirement_update = $tool({
    description:
      "Update a requirement by its number. Omitted fields stay as they are.",
    title: "Update requirement",
    schema: {
      params: requirementUpdateParamsSchema,
      result: requirementWriteResultSchema,
    },
    handler: async ({ params }) => {
      const { project, project_name, number, ...fields } = params;
      const projectId = await this.projectId(project, project_name);
      const row = await this.requirements.byNumber(projectId, number);
      return await this.requirements.updateRequirement({
        params: { id: row.id },
        body: await this.inputOf(projectId, fields),
      });
    },
  });

  requirement_delete = $tool({
    description:
      "Delete a requirement by its number. Its number is never reused; the criteria verifying it verify nothing afterwards.",
    title: "Delete requirement",
    annotations: { destructiveHint: true },
    schema: {
      params: requirementDeleteParamsSchema,
      result: requirementDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const row = await this.requirements.byNumber(projectId, params.number);
      await this.requirements.deleteRequirement({ params: { id: row.id } });
      return { ok: true, number: params.number };
    },
  });

  requirement_set_release = $tool({
    description:
      "Set the release a requirement ships in. Without covering epics it is stored by hand. With them, EVERY covering epic moves to that release (a requirement ships when all the work covering it has): when one of them covers other requirements or already sits in another release, nothing changes and `moves` lists what would; call again with confirm: true.",
    title: "Set requirement release",
    schema: {
      params: requirementSetReleaseParamsSchema,
      result: requirementSetReleaseResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      const row = await this.requirements.byNumber(projectId, params.number);
      let releaseId: number | null = null;
      if (params.release_tag) {
        const found = (
          await this.releaseController.getReleases({ params: { projectId } })
        ).find((release) => release.tag === params.release_tag);
        if (!found) {
          throw new NotFoundError(
            `Release '${params.release_tag}' not found in this project`,
          );
        }
        releaseId = found.id;
      }
      return await this.requirements.setRequirementRelease({
        params: { id: row.id },
        body: { releaseId, confirm: params.confirm },
      });
    },
  });

  criterion_verify_link = $tool({
    description:
      "Say which requirement a use case's acceptance criterion verifies (`#U7 C2` verifies `#S15`), or omit requirement_number to unlink it. A requirement's status is computed from the criteria verifying it.",
    title: "Link criterion to requirement",
    schema: {
      params: criterionVerifyLinkParamsSchema,
      result: criterionVerifyLinkResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projectId(
        params.project,
        params.project_name,
      );
      return await this.requirements.linkCriterion({
        params: { projectId },
        body: {
          useCaseNumber: params.usecase_number,
          criterionKey: params.key,
          requirementNumber: params.requirement_number ?? null,
        },
      });
    },
  });
}
