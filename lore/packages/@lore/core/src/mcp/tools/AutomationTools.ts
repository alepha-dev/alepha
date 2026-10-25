import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $tool } from "alepha/mcp";
import { currentUserAtom } from "alepha/security";
import {
  BadRequestError,
  UnauthorizedError,
  isHttpError,
  okSchema,
} from "alepha/server";

import { automationAdoptionPreviewSchema } from "../../api/schemas/automationAdoptionPreviewSchema.ts";
import { automationCatalogSchema } from "../../api/schemas/automationCatalogSchema.ts";
import { automationDependentPageSchema } from "../../api/schemas/automationDependentPageSchema.ts";
import { automationEvaluationReportSchema } from "../../api/schemas/automationEvaluationReportSchema.ts";
import { automationPageSchema } from "../../api/schemas/automationPageSchema.ts";
import { automationResourceSchema } from "../../api/schemas/automationResourceSchema.ts";
import { automationRunPageSchema } from "../../api/schemas/automationRunPageSchema.ts";
import { automationVariablePageSchema } from "../../api/schemas/automationVariablePageSchema.ts";
import { automationVariableSetResponseSchema } from "../../api/schemas/automationVariableSetResponseSchema.ts";
import { AutomationAdoptionService } from "../../api/services/AutomationAdoptionService.ts";
import { AutomationService } from "../../api/services/AutomationService.ts";
import { AutomationVariableService } from "../../api/services/AutomationVariableService.ts";
import { automationAdoptionPreviewParamsSchema } from "../schemas/automationAdoptionPreviewParamsSchema.ts";
import { automationAdoptParamsSchema } from "../schemas/automationAdoptParamsSchema.ts";
import { automationCreateParamsSchema } from "../schemas/automationCreateParamsSchema.ts";
import { automationCreateResultSchema } from "../schemas/automationCreateResultSchema.ts";
import { automationDeleteParamsSchema } from "../schemas/automationDeleteParamsSchema.ts";
import { automationGetParamsSchema } from "../schemas/automationGetParamsSchema.ts";
import { automationListParamsSchema } from "../schemas/automationListParamsSchema.ts";
import { automationRunsParamsSchema } from "../schemas/automationRunsParamsSchema.ts";
import { automationTestParamsSchema } from "../schemas/automationTestParamsSchema.ts";
import { automationUpdateParamsSchema } from "../schemas/automationUpdateParamsSchema.ts";
import { automationVariableDeleteParamsSchema } from "../schemas/automationVariableDeleteParamsSchema.ts";
import { automationVariableDependentsParamsSchema } from "../schemas/automationVariableDependentsParamsSchema.ts";
import { automationVariableListParamsSchema } from "../schemas/automationVariableListParamsSchema.ts";
import { automationVariableSetParamsSchema } from "../schemas/automationVariableSetParamsSchema.ts";
import { projectParamsSchema } from "../schemas/projectParamsSchema.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP serializes the shared application services. It never writes a rule,
 * variable, author identity or execution credential directly.
 */
export class AutomationTools {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly projects = $inject(ProjectTools);
  protected readonly service = $inject(AutomationService);
  protected readonly adoption = $inject(AutomationAdoptionService);
  protected readonly variables = $inject(AutomationVariableService);

  protected user() {
    const user = this.alepha.store.get(currentUserAtom);
    if (!user) throw new UnauthorizedError("Authentication required");
    return user;
  }
  protected project(input: { project?: number; project_name?: string }) {
    return this.projects.resolveProjectId(input.project, input.project_name);
  }

  automation_adoption_preview = $tool({
    description:
      "Preview explicit per-project compatibility adoption as the named caller: preserved state, recipients, channels, grants and permanent legacy cutover. No writes. No capabilities or grants are enabled automatically.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationAdoptionPreviewParamsSchema,
      result: automationAdoptionPreviewSchema,
    },
    handler: async ({ params }) =>
      this.adoption.preview(
        await this.project(params),
        params.policy,
        this.user(),
      ),
  });
  automation_adopt = $tool({
    description:
      "Explicitly consent as the immutable author to adopt quest-reminders or release-notifications. Requires confirm=true and current grants/capabilities/channels. Resumes pending adoption. Optionally adopt your already configured compatible automationId with expectedRevision. The legacy marker survives disable/delete; repeating adoption never reenables an opted-out rule.",
    annotations: { idempotentHint: true },
    schema: {
      params: automationAdoptParamsSchema,
      result: automationAdoptionPreviewSchema,
    },
    handler: async ({ params }) =>
      this.adoption.adopt(
        await this.project(params),
        params.policy,
        this.user(),
        {
          confirm: params.confirm,
          automationId: params.automationId,
          expectedRevision: params.expectedRevision,
        },
      ),
  });
  automation_create = $tool({
    description:
      "Create a typed automation as yourself. Discover slots with automation_catalog. The rule is always created disabled; with enabled=true the tool then enables it in a second, validated step. If that step is refused, the created rule is still returned, disabled, with enableRefusal saying why: fix the cause, then enable it with automation_update (enabled=true, expectedRevision). The author and credential are immutable. No AI executes inside a rule.",
    schema: {
      params: automationCreateParamsSchema,
      result: automationCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      const user = this.user();
      const rule = await this.service.create(projectId, user, {
        title: params.title,
        rule: params.rule,
      });
      if (!params.enabled) return rule;
      try {
        return await this.service.setEnabled(
          projectId,
          rule.id,
          user,
          true,
          rule.revision,
        );
      } catch (error) {
        // The rule exists: answering only the error would lose its id, and a
        // retry of the create would make a second one.
        if (isHttpError(error) && error.status < 500)
          return { ...rule, enableRefusal: error.message.slice(0, 1024) };
        this.log.warn("automation_create: enable failed after create", {
          automationId: rule.id,
          error,
        });
        return {
          ...rule,
          enableRefusal:
            "Enabling failed; the rule was created disabled. Retry with automation_update.",
        };
      }
    },
  });
  automation_list = $tool({
    description:
      "List authorized automation metadata and configuration with bounded offset pagination, search, state and author filters. Credentials are never exposed.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationListParamsSchema,
      result: automationPageSchema,
    },
    handler: async ({ params }) =>
      this.service.list(await this.project(params), this.user(), {
        offset: params.offset,
        limit: params.limit,
        ...(params.search === undefined ? {} : { search: params.search }),
        ...(params.state === undefined ? {} : { state: params.state }),
        ...(params.authorUserId === undefined
          ? {}
          : { authorUserId: params.authorUserId }),
      }),
  });
  automation_get = $tool({
    description:
      "Read an automation, current health, author, revision, last run and permitted controls. Configuration is redacted when current source access is missing.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationGetParamsSchema,
      result: automationResourceSchema,
    },
    handler: async ({ params }) =>
      this.service.get(await this.project(params), params.id, this.user()),
  });
  automation_update = $tool({
    description:
      "Update your automation using expectedRevision. Supply title and the complete four-slot rule together, or enabled alone. Explicit enable revalidates current authority, dependencies and shared variables. Managers may disable another author's rule but cannot edit or enable it. Reload after a revision conflict.",
    schema: {
      params: automationUpdateParamsSchema,
      result: automationResourceSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      const user = this.user();
      if (params.enabled !== undefined)
        return this.service.setEnabled(
          projectId,
          params.id,
          user,
          params.enabled,
          params.expectedRevision,
        );
      if (params.title === undefined || params.rule === undefined)
        throw new BadRequestError("Configuration requires title and rule");
      return this.service.update(
        projectId,
        params.id,
        user,
        params.expectedRevision,
        { title: params.title, rule: params.rule },
      );
    },
  });
  automation_delete = $tool({
    description:
      "Soft-delete an automation using expectedRevision: your own with automation:write, or another author's with automation:manage. This deletes the rule, it does not pause it: to stop a rule and keep it, call automation_update with enabled=false. Retained run history survives; queued effects stop.",
    annotations: { destructiveHint: true },
    schema: { params: automationDeleteParamsSchema, result: okSchema },
    handler: async ({ params }) => {
      await this.service.remove(
        await this.project(params),
        params.id,
        this.user(),
        params.expectedRevision,
      );
      return { ok: true };
    },
  });
  automation_variable_set = $tool({
    description:
      "Create or change an explicitly shared typed variable with automation:manage. Existing variables require their immutable id and current version in variable. Returns affected rules; foreign authors' consumers pause for approval. Preset setup uses literals unless a binding is explicitly chosen.",
    schema: {
      params: automationVariableSetParamsSchema,
      result: automationVariableSetResponseSchema,
    },
    handler: async ({ params }) =>
      this.variables.set(
        await this.project(params),
        this.user(),
        params.key,
        params.variable,
      ),
  });
  automation_variable_list = $tool({
    description:
      "List project variables with typed values, immutable identities and versions, optionally narrowed to one exact key. Values requiring unavailable source access are redacted. Use automation_variable_dependents to inspect usage before editing or deleting.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationVariableListParamsSchema,
      result: automationVariablePageSchema,
    },
    handler: async ({ params }) =>
      this.variables.list(await this.project(params), this.user(), {
        offset: params.offset,
        limit: params.limit,
        ...(params.key === undefined ? {} : { key: params.key }),
      }),
  });
  automation_variable_dependents = $tool({
    description:
      "List rules using a shared variable with bounded offset pagination. Requires automation:manage. Deletion is refused while any consumer remains.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationVariableDependentsParamsSchema,
      result: automationDependentPageSchema,
    },
    handler: async ({ params }) =>
      this.variables.dependents(
        await this.project(params),
        this.user(),
        params.key,
        { offset: params.offset, limit: params.limit },
      ),
  });
  automation_variable_delete = $tool({
    description:
      "Delete an unused shared variable with automation:manage. Both id and version must match. Used variables are refused; inspect automation_variable_dependents first.",
    annotations: { destructiveHint: true },
    schema: { params: automationVariableDeleteParamsSchema, result: okSchema },
    handler: async ({ params }) => {
      await this.variables.remove(
        await this.project(params),
        this.user(),
        params.key,
        params.id,
        params.version,
      );
      return { ok: true };
    },
  });
  automation_runs = $tool({
    description:
      "Read bounded retained run pages for an automation ID. Snapshots show exact or capped counts and per-action outcomes. notifications contains live receipt status separately from enqueue: queued is not delivery, email sent is transport acceptance, and inbox delivery is delivered. Payloads and receipt identities are redacted without current source-read access. Details retain 30 days; replay receipts retain 90 days.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationRunsParamsSchema,
      result: automationRunPageSchema,
    },
    handler: async ({ params }) =>
      this.service.runs(await this.project(params), params.id, this.user(), {
        offset: params.offset,
        limit: params.limit,
      }),
  });
  automation_catalog = $tool({
    description:
      "Discover the current authorized automation vocabulary: typed event, selection, metric and action slots; fields, cardinalities, operators, required capabilities and permissions; configured channels, shared variables, the preset setups offered in this project and execution limits. Unavailable entries explain why. Presets are listed for reference: they are applied from the web gallery, while MCP composes the equivalent four-slot rule with automation_create.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: automationCatalogSchema,
    },
    handler: async ({ params }) =>
      this.service.catalogue(await this.project(params), this.user()),
  });
  automation_test = $tool({
    description:
      "Preview a saved rule without writes, audit, delivery, health, cursor or baseline changes. Event input is a same-project subject ID or a retained event/run ID, never caller JSON. Returns timestamped typed inputs, counts, guards and rendered planned effects. A preview is not delivery confirmation.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationTestParamsSchema,
      result: automationEvaluationReportSchema,
    },
    handler: async ({ params }) =>
      this.service.test(
        await this.project(params),
        params.id,
        this.user(),
        params.source,
      ),
  });
}
