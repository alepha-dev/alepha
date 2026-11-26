import { $inject, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  McpInputRequiredSignal,
  McpInvalidParamsError,
  McpServerProvider,
  type McpTaskInit,
  McpTaskNotWaitingError,
  type McpTaskState,
  McpTaskStore,
  type McpToolCallResult,
} from "alepha/mcp";
import { $repository } from "alepha/orm";

import {
  type JobExecutionEntity,
  jobExecutionEntity,
} from "../entities/jobExecutionEntity.ts";
import { JobInputNotAwaitedError } from "../errors/JobInputNotAwaitedError.ts";
import { $job } from "../primitives/$job.ts";
import type { JobStep } from "../schemas/jobStepSchema.ts";
import { JobProvider } from "./JobProvider.ts";

/**
 * The `$job`-backed `McpTaskStore`: an MCP task is a run of the `system.mcp.task`
 * job, and its id is the execution's uuid.
 *
 * - **Durable before it is returned**: `create` pushes the run, whose row is
 *   written before the id comes back.
 * - **Kept until its ttl**: the row carries `expiresAt = createdAt + ttlMs`,
 *   the retention floor no success, failure, cancel or trim deletes it
 *   before, and the job keeps its result (`keepResult`).
 * - **Input**: a tool that elicits parks the run on a `step.input` named
 *   `input.e<round>`, one round per question; `answer` writes the answers
 *   and wakes it, and the tool replays from the top with every answer so
 *   far. Past the ttl unanswered, the run fails.
 * - **No retry** (`retries: 0`): a tool call is not replayed behind its
 *   caller's back after it failed.
 *
 * Opt-in, bound by the app (with `AlephaApiJobs` and `AlephaMcp`):
 *
 * ```ts
 * alepha.with({ provide: McpTaskStore, use: JobMcpTaskStore });
 * ```
 */
export class JobMcpTaskStore extends McpTaskStore {
  protected readonly jobs = $inject(JobProvider);
  protected readonly mcp = $inject(McpServerProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly executions = $repository(jobExecutionEntity);

  public readonly task = $job({
    name: "system.mcp.task",
    description: "Runs an MCP tool call answered as a task.",
    schema: z.object({
      tool: z.text(),
      arguments: z.record(z.text(), z.any()),
      clientKey: z.text(),
      data: z.any().optional(),
      elicitation: z.record(z.text(), z.any()).optional(),
      ttlMs: z.integer(),
      expiresAt: z.datetime(),
    }),
    keepResult: true,
    // One pass of the tool. A tool longer than Cloudflare's direct-mode
    // budget needs a queue dispatcher (`AlephaApiJobsQueue`) there.
    timeout: [10, "minute"],
    handler: async ({ payload, step, executionId, signal }) => {
      const until = new Date(payload.expiresAt);
      // Every round asked so far, from the row: their answers replay
      // together, so the tool runs once per pass, not once per round. The
      // round still waiting (the run woke at its expiry, or early) goes
      // through `step.input`, which fails it or parks it again.
      const row = await this.executions.findById(executionId);
      const rounds = this.roundsOf(row);
      const answers: Record<string, unknown> = {};
      for (const [name, entry] of rounds) {
        Object.assign(
          answers,
          entry.answers ??
            (await step.input(name, entry.requests ?? {}, until)),
        );
      }
      try {
        return await this.mcp.runTask({
          tool: payload.tool,
          arguments: payload.arguments,
          clientKey: payload.clientKey,
          data: payload.data,
          elicitation: payload.elicitation,
          taskId: executionId,
          answers,
          signal,
        });
      } catch (error) {
        if (!(error instanceof McpInputRequiredSignal)) {
          throw error;
        }
        // A new round: parks the run until answered, or fails it past the
        // task's expiry. Either way the call throws.
        await step.input(
          `input.e${rounds.length}`,
          { [error.data.key]: error.data.inputRequest },
          until,
        );
        throw new AlephaError(
          `MCP task ${executionId}: step.input returned for a new round`,
        );
      }
    },
  });

  /**
   * The input rounds a run recorded, `input.e0`, `input.e1`, ..., in order.
   */
  protected roundsOf(
    row: JobExecutionEntity | undefined,
  ): Array<[string, JobStep]> {
    return Object.entries(row?.steps ?? {})
      .filter(([name, entry]) => /^input\.e\d+$/.test(name) && entry.requests)
      .sort(([a], [b]) => Number(a.slice(7)) - Number(b.slice(7)));
  }

  public async create(task: McpTaskInit): Promise<McpTaskState> {
    const expiresAt = this.dt.now().add(task.ttlMs, "millisecond");
    const id = await this.task.push(
      {
        tool: task.tool,
        arguments: task.arguments,
        clientKey: task.clientKey,
        data: task.data,
        elicitation: task.elicitation,
        ttlMs: task.ttlMs,
        expiresAt: expiresAt.toISOString(),
      },
      { expiresAt: expiresAt.toDate() },
    );
    const state = await this.get(id);
    if (!state) {
      throw new AlephaError(`MCP task ${id} vanished as it was created`);
    }
    return state;
  }

  public async get(id: string): Promise<McpTaskState | undefined> {
    const row = await this.row(id);
    if (!row) {
      return undefined;
    }
    const payload = row.payload as { clientKey: string; ttlMs: number };
    const state: McpTaskState = {
      id: row.id,
      clientKey: payload.clientKey,
      status: "working",
      createdAt: row.createdAt,
      lastUpdatedAt: row.updatedAt,
      ttlMs: payload.ttlMs,
    };
    switch (row.status) {
      case "ok":
        state.status = "completed";
        state.result = row.result as McpToolCallResult | undefined;
        break;
      case "error":
        state.status = "failed";
        state.error = { code: -32603, message: row.error ?? "Task failed" };
        break;
      case "cancelled":
        state.status = "cancelled";
        break;
      case "scheduled": {
        const waiting = this.waitingInput(row);
        if (waiting) {
          state.status = "input_required";
          state.inputRequests = waiting[1].requests;
        }
        break;
      }
    }
    return state;
  }

  public async answer(
    id: string,
    inputResponses: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.row(id);
    const waiting = row ? this.waitingInput(row) : undefined;
    if (!waiting) {
      throw new McpTaskNotWaitingError({ taskId: id });
    }
    const [name, entry] = waiting;
    // Only the keys the round asked; any other is ignored, as on MRTR.
    const answers: Record<string, unknown> = {};
    for (const key of Object.keys(entry.requests ?? {})) {
      if (key in inputResponses) {
        answers[key] = inputResponses[key];
      }
    }
    // Nothing it waits on answered: refused rather than woken for nothing.
    if (Object.keys(answers).length === 0) {
      throw new McpInvalidParamsError(
        "Invalid params: inputResponses answers none of the task's input requests",
      );
    }
    try {
      await this.jobs.answerInput(id, name, answers);
    } catch (error) {
      if (error instanceof JobInputNotAwaitedError) {
        throw new McpTaskNotWaitingError({ taskId: id });
      }
      throw error;
    }
  }

  public async cancel(id: string): Promise<boolean> {
    const row = await this.row(id);
    if (!row) {
      return false;
    }
    if (
      row.status === "pending" ||
      row.status === "running" ||
      row.status === "scheduled"
    ) {
      // Lost to a run that finished meanwhile: cancellation is cooperative.
      await this.jobs.cancel(id).catch(() => undefined);
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The task's row: an `system.mcp.task` execution still inside its ttl.
   */
  protected async row(id: string): Promise<JobExecutionEntity | undefined> {
    if (!this.isUuid(id)) {
      return undefined;
    }
    const row = await this.executions.findById(id).catch(() => undefined);
    if (!row || row.jobName !== "system.mcp.task") {
      return undefined;
    }
    if (
      row.expiresAt &&
      new Date(row.expiresAt).getTime() <= this.dt.nowMillis()
    ) {
      return undefined;
    }
    return row;
  }

  /**
   * The unanswered input entry a parked run waits on.
   */
  protected waitingInput(
    row: JobExecutionEntity,
  ): [string, JobStep] | undefined {
    if (row.status !== "scheduled") {
      return undefined;
    }
    for (const [name, entry] of Object.entries(row.steps ?? {})) {
      if (entry.requests && entry.answers === undefined) {
        return [name, entry];
      }
    }
    return undefined;
  }

  protected isUuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );
  }
}
