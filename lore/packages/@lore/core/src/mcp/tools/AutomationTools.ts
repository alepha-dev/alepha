import { $inject, Alepha, z } from "alepha";
import { $tool } from "alepha/mcp";
import { currentUserAtom } from "alepha/security";
import { BadRequestError, UnauthorizedError, okSchema } from "alepha/server";

import { automationCatalogSchema } from "../../api/schemas/automationCatalogSchema.ts";
import { automationDependentPageSchema } from "../../api/schemas/automationDependentPageSchema.ts";
import { automationEvaluationReportSchema } from "../../api/schemas/automationEvaluationReportSchema.ts";
import { automationPageSchema } from "../../api/schemas/automationPageSchema.ts";
import { automationResourceSchema } from "../../api/schemas/automationResourceSchema.ts";
import { automationRunPageSchema } from "../../api/schemas/automationRunPageSchema.ts";
import { automationVariablePageSchema } from "../../api/schemas/automationVariablePageSchema.ts";
import { automationVariableSetResponseSchema } from "../../api/schemas/automationVariableSetResponseSchema.ts";
import { projectChannelResourceSchema } from "../../api/schemas/projectChannelResourceSchema.ts";
import { AutomationService } from "../../api/services/AutomationService.ts";
import { AutomationVariableService } from "../../api/services/AutomationVariableService.ts";
import { ProjectChannelService } from "../../api/services/ProjectChannelService.ts";
import { automationCreateParamsSchema } from "../schemas/automationCreateParamsSchema.ts";
import { automationDeleteParamsSchema } from "../schemas/automationDeleteParamsSchema.ts";
import { automationGetParamsSchema } from "../schemas/automationGetParamsSchema.ts";
import { AutomationGraphParams } from "../schemas/AutomationGraphParams.ts";
import { automationListParamsSchema } from "../schemas/automationListParamsSchema.ts";
import { automationRunsParamsSchema } from "../schemas/automationRunsParamsSchema.ts";
import { automationSourceSetParamsSchema } from "../schemas/automationSourceSetParamsSchema.ts";
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
  protected readonly projects = $inject(ProjectTools);
  protected readonly service = $inject(AutomationService);
  protected readonly variables = $inject(AutomationVariableService);
  protected readonly channelService = $inject(ProjectChannelService);

  protected user() {
    const user = this.alepha.store.get(currentUserAtom);
    if (!user) throw new UnauthorizedError("Authentication required");
    return user;
  }
  protected project(input: { project?: number; project_name?: string }) {
    return this.projects.resolveProjectId(input.project, input.project_name);
  }

  automation_create = $tool({
    description:
      'Create an automation as yourself: a graph of sources (an event or a schedule) wired through optional reads and conditions to actions. Discover node types, their slots, ports and outputs with automation_catalog. Pass the graph as nodes + edges, or the compact sources + actions (every source wired to every action), which is enough for "when X or Y, notify me". The graph is an outline of blocks: each block is its events (or one schedule and its read), at most one condition, then independent sequences of actions on the true and false sides of the condition; nothing joins (wire an action on both sides instead), a condition leads to actions only, and an action is followed by one action at most. With enabled=true it is created enabled in one atomic write, after the checks enabling runs; if they refuse, nothing is created and the refusal says why and names the node. Without it it is a draft. The author and credential are immutable. No AI executes inside an automation.',
    schema: {
      params: automationCreateParamsSchema,
      result: automationResourceSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      return this.service.create(projectId, this.user(), {
        title: params.title,
        ...AutomationGraphParams.body(params),
        enabled: params.enabled,
      });
    },
  });
  automation_list = $tool({
    description:
      'List authorized automations with bounded offset pagination, search, state and author filters: each with its graph, each source\'s switch, health and a one-line summary ("host.offline -> notify inbox, email"). Credentials are never exposed.',
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
      "Read an automation: its graph (nodes + edges), each source's switch, health and one-line summary, its health, author, revision, last run and permitted controls. The graph is redacted when current source access is missing.",
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
      "Update your automation using expectedRevision. Supply title with the complete graph (nodes + edges, or the compact sources + actions), or enabled alone. The graph is an outline of blocks: each block is its events (or one schedule and its read), at most one condition, then independent sequences of actions on the true and false sides of the condition; nothing joins (wire an action on both sides instead), a condition leads to actions only, and an action is followed by one action at most. Explicit enable revalidates current authority, dependencies and shared variables. To switch one source, use automation_source_set. Managers may disable another author's automation but cannot edit or enable it. Reload after a revision conflict.",
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
      if (
        params.title === undefined ||
        (params.nodes === undefined && params.sources === undefined)
      )
        throw new BadRequestError(
          "Configuration requires title with nodes and edges, or sources and actions",
        );
      return this.service.update(
        projectId,
        params.id,
        user,
        params.expectedRevision,
        {
          title: params.title,
          ...AutomationGraphParams.body(params),
        },
      );
    },
  });
  automation_source_set = $tool({
    description:
      "Switch one source of an automation off or on, using expectedRevision. Off: the automation's author, a manager, or the owner of their own bell; it stops that source alone and leaves the others running. On: the author only, after the checks enabling runs. A bell's per-event switch is this.",
    schema: {
      params: automationSourceSetParamsSchema,
      result: automationResourceSchema,
    },
    handler: async ({ params }) =>
      this.service.setSourceEnabled(
        await this.project(params),
        params.id,
        this.user(),
        params.node,
        params.enabled,
        params.expectedRevision,
      ),
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
  automation_channel_list = $tool({
    description:
      "List the project's notification channels a rule may name in a notify's `channels`: In-app and Email (built in), then every configured channel such as a Discord channel, with its id, kind and name. Never a webhook URL: channels are added in the browser, in Settings > Automations > Channels.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema,
      result: z.object({ items: z.array(projectChannelResourceSchema) }),
    },
    handler: async ({ params }) => ({
      items: await this.channelService.list(
        await this.project(params),
        this.user(),
      ),
    }),
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
        {
          offset: params.offset,
          limit: params.limit,
        },
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
      "Read bounded retained run pages for an automation ID, optionally only those one source started (source). Each run names its source (sourceNode) and what each node did (nodes: ran, skipped, refused, failed, unknown, not_reached, with the port a condition took); snapshots show exact or capped counts and per-step outcomes. notifications contains live receipt status separately from enqueue: queued is not delivery, email sent is transport acceptance, and inbox delivery is delivered. Payloads and receipt identities are redacted without current source-read access. Details retain 30 days; replay receipts retain 90 days.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: automationRunsParamsSchema,
      result: automationRunPageSchema,
    },
    handler: async ({ params }) =>
      this.service.runs(await this.project(params), params.id, this.user(), {
        offset: params.offset,
        limit: params.limit,
        ...(params.source === undefined ? {} : { source: params.source }),
      }),
  });
  automation_catalog = $tool({
    description:
      "Discover what an automation may hold here: nodeTypes (each node type's kind: source, read, condition or action; its ports, the fields it brings, its slots and, for an action, the outputs it gives the actions after it, such as created_quest_id), the vocabulary entries behind them with required capabilities and permissions, configured channels, shared variables, the presets offered in this project, and the limits (8 sources, 40 nodes, 5 actions reachable from one source). Unavailable entries explain why. A node may use the fields every source reaching it provides, and the outputs of an action on every path to it. Presets are applied from the web gallery; compose the graph yourself with automation_create.",
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
      "Preview a saved automation from one of its sources (node, required when it has several) without writes, audit, delivery, health, cursor or baseline changes. Event input is a same-project subject ID or a retained event/run ID, never caller JSON; a past run starts from its own source. Returns timestamped typed inputs, counts, the conditions decided, the path it would walk (nodes) and rendered planned effects; a slot bound to an earlier action's output is reported as known only when the run is real. A preview is not delivery confirmation.",
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
        params.node,
      ),
  });
}
