import { $inject } from "alepha";
import { $action, okSchema } from "alepha/server";

import { automationAdoptionBodySchema } from "../schemas/automationAdoptionBodySchema.ts";
import { automationAdoptionParamsSchema } from "../schemas/automationAdoptionParamsSchema.ts";
import { automationAdoptionPreviewSchema } from "../schemas/automationAdoptionPreviewSchema.ts";
import { automationCatalogSchema } from "../schemas/automationCatalogSchema.ts";
import { automationDependentPageSchema } from "../schemas/automationDependentPageSchema.ts";
import { automationEnableBodySchema } from "../schemas/automationEnableBodySchema.ts";
import { automationEvaluationReportSchema } from "../schemas/automationEvaluationReportSchema.ts";
import { automationListQuerySchema } from "../schemas/automationListQuerySchema.ts";
import { automationPageQuerySchema } from "../schemas/automationPageQuerySchema.ts";
import { automationPageSchema } from "../schemas/automationPageSchema.ts";
import { automationParamsSchema } from "../schemas/automationParamsSchema.ts";
import { automationPresetCreateSchema } from "../schemas/automationPresetCreateSchema.ts";
import { automationProjectParamsSchema } from "../schemas/automationProjectParamsSchema.ts";
import { automationResourceSchema } from "../schemas/automationResourceSchema.ts";
import { automationRevisionBodySchema } from "../schemas/automationRevisionBodySchema.ts";
import { automationRunPageSchema } from "../schemas/automationRunPageSchema.ts";
import { automationRunResourceSchema } from "../schemas/automationRunResourceSchema.ts";
import { automationSetupOptionPageSchema } from "../schemas/automationSetupOptionPageSchema.ts";
import { automationSetupQuerySchema } from "../schemas/automationSetupQuerySchema.ts";
import { automationTestBodySchema } from "../schemas/automationTestBodySchema.ts";
import { automationUpdateBodySchema } from "../schemas/automationUpdateBodySchema.ts";
import { automationVariableDeleteBodySchema } from "../schemas/automationVariableDeleteBodySchema.ts";
import { automationVariableListQuerySchema } from "../schemas/automationVariableListQuerySchema.ts";
import { automationVariablePageSchema } from "../schemas/automationVariablePageSchema.ts";
import { automationVariableParamsSchema } from "../schemas/automationVariableParamsSchema.ts";
import { automationVariableSetBodySchema } from "../schemas/automationVariableSetBodySchema.ts";
import { automationVariableSetResponseSchema } from "../schemas/automationVariableSetResponseSchema.ts";
import { automationWriteBodySchema } from "../schemas/automationWriteBodySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AutomationAdoptionService } from "../services/AutomationAdoptionService.ts";
import { AutomationPresetService } from "../services/AutomationPresetService.ts";
import { AutomationService } from "../services/AutomationService.ts";
import { AutomationSetupOptions } from "../services/AutomationSetupOptions.ts";
import { AutomationVariableService } from "../services/AutomationVariableService.ts";

/**
 * HTTP is serialization and the ordinary project gate. All executable policy
 * remains in the same services called by MCP and trusted preset creation.
 */
export class AutomationController {
  protected readonly adoption = $inject(AutomationAdoptionService);
  protected readonly setupOptions = $inject(AutomationSetupOptions);
  protected readonly presets = $inject(AutomationPresetService);
  protected readonly service = $inject(AutomationService);
  protected readonly variables = $inject(AutomationVariableService);
  protected readonly mutationGate = $ownsProject({
    param: "projectId",
    capability: { key: "work", option: "automations" },
  });
  protected gate = (permission: string) =>
    $ownsProject({
      param: "projectId",
      requires: permission,
      capability: { key: "work", option: "automations" },
    });

  previewAutomationAdoption = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automation-adoptions/:policy",
    schema: {
      params: automationAdoptionParamsSchema,
      response: automationAdoptionPreviewSchema,
    },
    handler: ({ params, user }) =>
      this.adoption.preview(params.projectId, params.policy, user),
  });
  adoptAutomationPolicy = $action({
    use: [this.gate("automation:write")],
    method: "POST",
    path: "/projects/:projectId/automation-adoptions/:policy",
    schema: {
      params: automationAdoptionParamsSchema,
      body: automationAdoptionBodySchema,
      response: automationAdoptionPreviewSchema,
    },
    handler: ({ params, body, user }) =>
      this.adoption.adopt(params.projectId, params.policy, user, body),
  });
  getAutomationSetupOptions = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automation-setup-options",
    schema: {
      params: automationProjectParamsSchema,
      query: automationSetupQuerySchema,
      response: automationSetupOptionPageSchema,
    },
    handler: ({ params, query, user }) =>
      this.setupOptions.list(params.projectId, user, query),
  });
  listAutomations = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automations",
    schema: {
      params: automationProjectParamsSchema,
      query: automationListQuerySchema,
      response: automationPageSchema,
    },
    handler: ({ params, query, user }) =>
      this.service.list(params.projectId, user, query),
  });
  getAutomation = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automations/:id",
    schema: {
      params: automationParamsSchema,
      response: automationResourceSchema,
    },
    handler: ({ params, user }) =>
      this.service.get(params.projectId, params.id, user),
  });
  createAutomation = $action({
    use: [this.gate("automation:write")],
    method: "POST",
    path: "/projects/:projectId/automations",
    schema: {
      params: automationProjectParamsSchema,
      body: automationWriteBodySchema,
      response: automationResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.create(params.projectId, user, body),
  });
  createAutomationFromPreset = $action({
    use: [this.gate("automation:write")],
    method: "POST",
    path: "/projects/:projectId/automation-presets",
    schema: {
      params: automationProjectParamsSchema,
      body: automationPresetCreateSchema,
      response: automationResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.presets.create(params.projectId, user, body),
  });
  updateAutomation = $action({
    use: [this.gate("automation:write")],
    method: "PUT",
    path: "/projects/:projectId/automations/:id",
    schema: {
      params: automationParamsSchema,
      body: automationUpdateBodySchema,
      response: automationResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.update(
        params.projectId,
        params.id,
        user,
        body.expectedRevision,
        { title: body.title, rule: body.rule },
      ),
  });
  setAutomationEnabled = $action({
    use: [this.mutationGate],
    method: "PATCH",
    path: "/projects/:projectId/automations/:id/enabled",
    schema: {
      params: automationParamsSchema,
      body: automationEnableBodySchema,
      response: automationResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.setEnabled(
        params.projectId,
        params.id,
        user,
        body.enabled,
        body.expectedRevision,
      ),
  });
  deleteAutomation = $action({
    use: [this.mutationGate],
    method: "DELETE",
    path: "/projects/:projectId/automations/:id",
    schema: {
      params: automationParamsSchema,
      body: automationRevisionBodySchema,
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.service.remove(
        params.projectId,
        params.id,
        user,
        body.expectedRevision,
      );
      return { ok: true };
    },
  });
  testAutomation = $action({
    use: [this.gate("automation:read")],
    method: "POST",
    path: "/projects/:projectId/automations/:id/test",
    schema: {
      params: automationParamsSchema,
      body: automationTestBodySchema,
      response: automationEvaluationReportSchema,
    },
    handler: ({ params, body, user }) =>
      this.service.test(params.projectId, params.id, user, body.source),
  });
  getAutomationCatalog = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automation-catalog",
    schema: {
      params: automationProjectParamsSchema,
      response: automationCatalogSchema,
    },
    handler: ({ params, user }) =>
      this.service.catalogue(params.projectId, user),
  });
  listAutomationRuns = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automations/:id/runs",
    schema: {
      params: automationParamsSchema,
      query: automationPageQuerySchema,
      response: automationRunPageSchema,
    },
    handler: ({ params, query, user }) =>
      this.service.runs(params.projectId, params.id, user, query),
  });
  getAutomationRun = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automation-runs/:id",
    schema: {
      params: automationParamsSchema,
      response: automationRunResourceSchema,
    },
    handler: ({ params, user }) =>
      this.service.run(params.projectId, params.id, user),
  });
  listAutomationVariables = $action({
    use: [this.gate("automation:read")],
    method: "GET",
    path: "/projects/:projectId/automation-variables",
    schema: {
      params: automationProjectParamsSchema,
      query: automationVariableListQuerySchema,
      response: automationVariablePageSchema,
    },
    handler: ({ params, query, user }) =>
      this.variables.list(params.projectId, user, query),
  });
  setAutomationVariable = $action({
    use: [this.gate("automation:manage")],
    method: "PUT",
    path: "/projects/:projectId/automation-variables/:key",
    schema: {
      params: automationVariableParamsSchema,
      body: automationVariableSetBodySchema,
      response: automationVariableSetResponseSchema,
    },
    handler: ({ params, body, user }) =>
      this.variables.set(params.projectId, user, params.key, body),
  });
  deleteAutomationVariable = $action({
    use: [this.gate("automation:manage")],
    method: "DELETE",
    path: "/projects/:projectId/automation-variables/:key",
    schema: {
      params: automationVariableParamsSchema,
      body: automationVariableDeleteBodySchema,
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.variables.remove(
        params.projectId,
        user,
        params.key,
        body.id,
        body.version,
      );
      return { ok: true };
    },
  });
  getAutomationVariableDependents = $action({
    use: [this.gate("automation:manage")],
    method: "GET",
    path: "/projects/:projectId/automation-variables/:key/dependents",
    schema: {
      params: automationVariableParamsSchema,
      query: automationPageQuerySchema,
      response: automationDependentPageSchema,
    },
    handler: ({ params, query, user }) =>
      this.variables.dependents(params.projectId, user, params.key, query),
  });
}
