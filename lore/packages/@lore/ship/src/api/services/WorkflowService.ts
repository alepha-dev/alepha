import {
  GitHubClient,
  GitHubText,
  GitHubTokenService,
  GitHubWebhookHandlers,
  type GitHubWebhookContext,
  JobKeyService,
  LoreAudits,
  ProjectRepositoryService,
} from "@lore/core/api";
import { type ProjectRepository, users } from "@lore/core/schemas";
import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";
import { CORE_SCHEMA, load as parseYaml } from "js-yaml";

import {
  type WorkflowDispatchRow,
  workflowDispatches,
} from "../entities/workflowDispatches.ts";
import type { WorkflowDispatchBody } from "../schemas/workflowDispatchBodySchema.ts";
import type { WorkflowInput } from "../schemas/workflowInputSchema.ts";
import type { WorkflowRun } from "../schemas/workflowRunSchema.ts";
import type { Workflow } from "../schemas/workflowSchema.ts";
import type { WorkflowsResource } from "../schemas/workflowsResourceSchema.ts";

/**
 * Starting a GitHub workflow from Lore (#Q4366, epic #E177): the connected
 * repository's workflows that declare `workflow_dispatch`, with the inputs
 * read from their files; a dispatch on a branch or tag; a re-run, a re-run
 * of the failed jobs, a cancel; and the recent runs.
 *
 * ## Guardrails
 *
 * - Every write needs `deploy:workflow` (the controller's gate) and is
 *   refused under a job key: an agent job never starts a workflow through
 *   Lore. A member who wants a job to run one approves it themselves.
 * - Every dispatch, re-run and cancel is a `github` row on the project's
 *   activity, with who asked and, for a dispatch, the ref and the inputs.
 * - A dispatch's inputs are checked against what the workflow declares:
 *   no unknown name, every required one given, a choice among its options.
 * - Lore never writes a workflow file: the App never asks `workflows`.
 *
 * The run a dispatch starts is matched on its `workflow_run` delivery, the
 * first of that workflow and ref created after the request.
 */
export class WorkflowService {
  /**
   * How many workflows a repository lists, each one file read.
   */
  public static readonly MAX_WORKFLOWS = 25;

  /**
   * How many recent runs the section shows.
   */
  public static readonly RECENT_RUNS = 20;

  /**
   * How long after its request a dispatch may still be matched to a run.
   */
  public static readonly MATCH_WINDOW_MS = 15 * 60_000;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly client = $inject(GitHubClient);
  protected readonly tokens = $inject(GitHubTokenService);
  protected readonly repositories = $inject(ProjectRepositoryService);
  protected readonly handlers = $inject(GitHubWebhookHandlers);
  protected readonly text = $inject(GitHubText);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dispatches = $repository(workflowDispatches);
  protected readonly users = $repository(users);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.handlers.register("workflow_run", (context) =>
        this.workflowRun(context),
      );
    },
  });

  /**
   * The section: the dispatchable workflows and the recent runs.
   */
  async list(projectId: number): Promise<WorkflowsResource> {
    const connection = await this.repositories.connectionOf(projectId);
    if (!connection) {
      return { connected: false, workflows: [], runs: [] };
    }
    const token = await this.repositories.readToken(connection);
    const [workflows, runs] = await Promise.all([
      this.workflows(connection, token),
      this.runs(connection, token),
    ]);
    return {
      connected: true,
      repository: `${connection.owner}/${connection.name}`,
      defaultBranch: connection.defaultBranch,
      workflows,
      runs,
    };
  }

  /**
   * Starts a workflow on a branch or tag, with its inputs checked.
   */
  async dispatch(
    projectId: number,
    body: WorkflowDispatchBody,
    user: UserAccountToken,
  ): Promise<{ id: string }> {
    await this.refuseJobKey(user);
    const connection = await this.require(projectId);
    const token = await this.repositories.readToken(connection);
    const workflow = (await this.workflows(connection, token)).find(
      (it) => it.id === body.workflowId,
    );
    if (!workflow) {
      throw new BadRequestError(
        `Workflow ${body.workflowId} does not declare workflow_dispatch in ${connection.owner}/${connection.name}`,
      );
    }
    const inputs = this.checkInputs(workflow, body.inputs ?? {});
    await this.client.dispatchWorkflow(
      await this.dispatchToken(connection),
      connection,
      workflow.id,
      { ref: body.ref, ...(Object.keys(inputs).length ? { inputs } : {}) },
    );
    const row = await this.dispatches.create({
      projectId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      ref: body.ref,
      ...(Object.keys(inputs).length ? { inputs } : {}),
      requestedBy: user.id,
      requestedAt: this.dateTime.nowISOString(),
    });
    await this.audits.github.logSuccess("dispatch", {
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "github-workflow",
      resourceId: String(workflow.id),
      description: `${workflow.name} on ${body.ref}`,
      metadata: { ref: body.ref, inputs, dispatchId: row.id },
    });
    return { id: row.id };
  }

  /**
   * Re-runs a run, or only its failed jobs.
   */
  async rerun(
    projectId: number,
    runId: number,
    failedOnly: boolean,
    user: UserAccountToken,
  ): Promise<void> {
    await this.refuseJobKey(user);
    const connection = await this.require(projectId);
    await this.client.rerunWorkflowRun(
      await this.dispatchToken(connection),
      connection,
      runId,
      failedOnly,
    );
    await this.audits.github.logSuccess("rerun", {
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "github-workflow-run",
      resourceId: String(runId),
      description: failedOnly ? `run ${runId}, failed jobs` : `run ${runId}`,
      metadata: { failedOnly },
    });
  }

  /**
   * Cancels a run.
   */
  async cancel(
    projectId: number,
    runId: number,
    user: UserAccountToken,
  ): Promise<void> {
    await this.refuseJobKey(user);
    const connection = await this.require(projectId);
    await this.client.cancelWorkflowRun(
      await this.dispatchToken(connection),
      connection,
      runId,
    );
    await this.audits.github.logSuccess("cancel", {
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "github-workflow-run",
      resourceId: String(runId),
      description: `run ${runId}`,
    });
  }

  // ---- internals ---------------------------------------------------------

  protected async require(projectId: number): Promise<ProjectRepository> {
    const connection = await this.repositories.connectionOf(projectId);
    if (!connection) {
      throw new BadRequestError(
        "The project is not connected to GitHub: connect it in Settings, GitHub",
      );
    }
    return connection;
  }

  /**
   * An agent job never starts, re-runs or cancels a workflow through Lore.
   */
  protected async refuseJobKey(user: UserAccountToken): Promise<void> {
    // The caller's token, then the request's: a tool call reaches the
    // action with the session's user, the key on the request.
    const keys = this.alepha.inject(JobKeyService);
    const key =
      (await keys.scopeOf(user).catch(() => undefined)) ??
      (await keys.current().catch(() => undefined));
    if (key) {
      throw new ForbiddenError(
        "An agent job cannot start, re-run or cancel a workflow: a member does it",
      );
    }
  }

  protected async dispatchToken(
    connection: ProjectRepository,
  ): Promise<string> {
    return (
      await this.tokens.installationToken({
        installationId: connection.installationId,
        repositoryId: connection.repositoryId,
        permissions: GitHubTokenService.DISPATCH,
      })
    ).token;
  }

  /**
   * The active workflows declaring `workflow_dispatch`, with their inputs,
   * read from each file at the default branch.
   */
  protected async workflows(
    connection: ProjectRepository,
    token: string,
  ): Promise<Workflow[]> {
    const listed = (await this.client.listWorkflows(token, connection))
      .filter((it) => it?.state === "active")
      .slice(0, WorkflowService.MAX_WORKFLOWS);
    const read = await Promise.all(
      listed.map(async (it): Promise<Workflow | undefined> => {
        const id = this.text.integer(it.id);
        const path = this.text.text(it.path, 500);
        if (id === undefined || !path?.startsWith(".github/workflows/")) {
          return undefined;
        }
        const file = await this.client
          .getFileText(token, connection, path, connection.defaultBranch)
          .catch(() => undefined);
        const inputs =
          file === undefined ? undefined : this.dispatchInputs(file);
        if (!inputs) return undefined;
        return {
          id,
          name: this.text.text(it.name, 200) ?? path,
          path,
          inputs,
        };
      }),
    );
    return read.filter((it): it is Workflow => it !== undefined);
  }

  /**
   * The inputs of a workflow file's `workflow_dispatch`, or undefined when
   * it declares none (or the file does not parse).
   */
  protected dispatchInputs(file: string): WorkflowInput[] | undefined {
    let doc: unknown;
    try {
      doc = parseYaml(file, { schema: CORE_SCHEMA });
    } catch {
      return undefined;
    }
    const on = this.text.object(doc)?.on;
    if (on === "workflow_dispatch") return [];
    if (Array.isArray(on)) {
      return on.includes("workflow_dispatch") ? [] : undefined;
    }
    const triggers = this.text.object(on);
    if (!triggers || !("workflow_dispatch" in triggers)) return undefined;
    const declared = this.text.object(
      this.text.object(triggers.workflow_dispatch)?.inputs,
    );
    if (!declared) return [];
    return Object.entries(declared)
      .slice(0, 25)
      .flatMap(([name, raw]): WorkflowInput[] => {
        if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(name)) return [];
        const input = this.text.object(raw) ?? {};
        const type = this.text.text(input.type, 20) ?? "string";
        const options = Array.isArray(input.options)
          ? input.options
              .slice(0, 100)
              .map((it) => this.scalar(it))
              .filter((it): it is string => it !== undefined)
          : undefined;
        const fallback = this.scalar(input.default);
        return [
          {
            name,
            required: input.required === true,
            type: (
              ["string", "boolean", "choice", "number", "environment"] as const
            ).includes(type as WorkflowInput["type"])
              ? (type as WorkflowInput["type"])
              : "string",
            ...(this.text.text(input.description, 500)
              ? { description: this.text.text(input.description, 500) }
              : {}),
            ...(fallback !== undefined ? { default: fallback } : {}),
            ...(options?.length ? { options } : {}),
          },
        ];
      });
  }

  protected scalar(value: unknown): string | undefined {
    if (typeof value === "string") return value.slice(0, 1_000);
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return undefined;
  }

  /**
   * The inputs as GitHub takes them, refused when a name is unknown, a
   * required one is missing, a boolean is not one, or a choice is not
   * among its options.
   */
  protected checkInputs(
    workflow: Workflow,
    given: Record<string, string>,
  ): Record<string, string> {
    const declared = new Map(workflow.inputs.map((it) => [it.name, it]));
    for (const name of Object.keys(given)) {
      if (!declared.has(name)) {
        throw new BadRequestError(
          `Workflow "${workflow.name}" has no input "${name}"`,
        );
      }
    }
    const inputs: Record<string, string> = {};
    for (const input of workflow.inputs) {
      const value = given[input.name];
      if (value === undefined || value === "") {
        if (input.required && input.default === undefined) {
          throw new BadRequestError(
            `Workflow "${workflow.name}" needs its input "${input.name}"`,
          );
        }
        continue;
      }
      if (input.type === "boolean" && value !== "true" && value !== "false") {
        throw new BadRequestError(`Input "${input.name}" is true or false`);
      }
      if (input.type === "number" && !Number.isFinite(Number(value))) {
        throw new BadRequestError(`Input "${input.name}" is a number`);
      }
      if (
        input.type === "choice" &&
        input.options &&
        !input.options.includes(value)
      ) {
        throw new BadRequestError(
          `Input "${input.name}" is one of: ${input.options.join(", ")}`,
        );
      }
      inputs[input.name] = value;
    }
    return inputs;
  }

  /**
   * The repository's recent runs, with who dispatched each from Lore.
   */
  protected async runs(
    connection: ProjectRepository,
    token: string,
  ): Promise<WorkflowRun[]> {
    const listed = await this.client.listWorkflowRuns(token, connection, {
      per_page: WorkflowService.RECENT_RUNS,
    });
    const runs = listed.flatMap((it): WorkflowRun[] => {
      const id = this.text.integer(it.id);
      const workflowId = this.text.integer(it.workflow_id);
      if (id === undefined || workflowId === undefined) return [];
      const conclusion = this.text.text(it.conclusion, 20);
      const actor = this.text.text(this.text.object(it.actor)?.login, 100);
      return [
        {
          id,
          workflowId,
          name: this.text.text(it.name, 200) ?? `run ${id}`,
          branch: this.text.text(it.head_branch, 255) ?? "",
          event: this.text.text(it.event, 50) ?? "",
          status: this.text.text(it.status, 20) ?? "",
          ...(conclusion ? { conclusion } : {}),
          url: this.text.text(it.html_url, 500) ?? "",
          createdAt: this.text.text(it.created_at, 40) ?? "",
          ...(actor ? { actor } : {}),
        },
      ];
    });
    const ids = runs.map((it) => it.id);
    if (ids.length === 0) return runs;
    const dispatched = await this.dispatches.findMany({
      where: {
        projectId: { eq: connection.projectId },
        runId: { inArray: ids },
      },
    });
    const userIds = [
      ...new Set(
        dispatched.flatMap((it) => (it.requestedBy ? [it.requestedBy] : [])),
      ),
    ];
    const people = userIds.length
      ? await this.users.findMany({ where: { id: { inArray: userIds } } })
      : [];
    const nameOf = new Map(
      people.map((it) => [
        it.id,
        [it.firstName, it.lastName].filter(Boolean).join(" ") ||
          it.username ||
          it.email ||
          "",
      ]),
    );
    const requester = new Map(
      dispatched.map((it) => [
        it.runId,
        it.requestedBy ? nameOf.get(it.requestedBy) : undefined,
      ]),
    );
    return runs.map((run) => {
      const by = requester.get(run.id);
      return by ? { ...run, requestedBy: by } : run;
    });
  }

  /**
   * A `workflow_run` delivery: matches a dispatch to the run it started,
   * then keeps the matched row's status and conclusion.
   */
  protected async workflowRun(context: GitHubWebhookContext): Promise<void> {
    const connection = context.connection;
    const run = this.text.object(context.payload.workflow_run);
    if (!connection || !run) return;
    const runId = this.text.integer(run.id);
    const workflowId = this.text.integer(run.workflow_id);
    if (runId === undefined || workflowId === undefined) return;
    const patch = {
      runUrl: this.text.text(run.html_url, 500),
      runStatus: this.text.text(run.status, 20),
      runConclusion: this.text.text(run.conclusion, 20),
    };
    const [held] = await this.dispatches.findMany({
      where: {
        projectId: { eq: connection.projectId },
        runId: { eq: runId },
      },
      limit: 1,
    });
    if (held) {
      await this.dispatches.updateById(held.id, this.defined(patch));
      return;
    }
    if (this.text.text(run.event, 50) !== "workflow_dispatch") return;
    const createdAt = Date.parse(this.text.text(run.created_at, 40) ?? "");
    if (!Number.isFinite(createdAt)) return;
    const branch = this.text.text(run.head_branch, 255) ?? "";
    const candidates = await this.dispatches.findMany({
      where: {
        projectId: { eq: connection.projectId },
        workflowId: { eq: workflowId },
        runId: { isNull: true },
        requestedAt: {
          gte: new Date(
            createdAt - WorkflowService.MATCH_WINDOW_MS,
          ).toISOString(),
        },
      },
      orderBy: { column: "requestedAt", direction: "asc" },
      limit: 10,
    });
    const match = candidates.find(
      (it: WorkflowDispatchRow) =>
        this.sameRef(it.ref, branch) &&
        Date.parse(it.requestedAt) <= createdAt + 60_000,
    );
    if (!match) return;
    await this.dispatches.updateById(match.id, {
      runId,
      ...this.defined(patch),
    });
  }

  /**
   * `refs/heads/main`, `refs/tags/v1` and `main` name the same ref as the
   * run's `head_branch`.
   */
  protected sameRef(ref: string, branch: string): boolean {
    return ref.replace(/^refs\/(heads|tags)\//, "") === branch;
  }

  protected defined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, it]) => it !== undefined),
    ) as Partial<T>;
  }
}
