import type { McpToolCallResult } from "../interfaces/McpTypes.ts";

/**
 * Where the Tasks extension (`io.modelcontextprotocol/tasks`) keeps a task:
 * a `tools/call` answered later, polled with `tasks/get`.
 *
 * `alepha/mcp` defines the contract and provides no implementation: a task
 * must outlive the request and the process that created it, which an
 * in-memory map cannot promise. Bind one explicitly, the `$job`-backed
 * `JobMcpTaskStore` of `alepha/api/jobs` being the one the framework ships:
 *
 * ```ts
 * alepha.with({ provide: McpTaskStore, use: JobMcpTaskStore });
 * ```
 *
 * With none bound, the server does not declare the extension and every
 * tool answers plainly.
 */
export abstract class McpTaskStore {
  /**
   * Record a task and start running it. Resolves once the task is durable,
   * before its tool has necessarily run: the id it returns can be polled
   * at once. The id must be unguessable: it is the task's only handle.
   */
  public abstract create(task: McpTaskInit): Promise<McpTaskState>;

  /**
   * A task's current state, or `undefined` when there is no such task or it
   * expired.
   */
  public abstract get(id: string): Promise<McpTaskState | undefined>;

  /**
   * Answer the input requests an `input_required` task is waiting on, keyed
   * as `get` returned them, and wake it. Throws `McpTaskNotWaitingError` when
   * the task is not waiting for input.
   */
  public abstract answer(
    id: string,
    inputResponses: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Ask a task to stop: a waiting task is cancelled at once, a running one
   * cooperatively (its signal aborts). Resolves `false` when there is no
   * such task.
   */
  public abstract cancel(id: string): Promise<boolean>;
}

/**
 * What a task is created from: the `tools/call` it answers, and what its
 * worker needs to run the tool as the caller.
 */
export interface McpTaskInit {
  /**
   * The tool's name.
   */
  tool: string;
  arguments: Record<string, unknown>;
  /**
   * The caller the task belongs to: only it may read, answer or cancel it.
   */
  clientKey: string;
  /**
   * `McpContext.data` of the creating call (the user, by default), handed to
   * the tool when it runs. Must be JSON.
   */
  data?: unknown;
  /**
   * The `elicitation` capability the client declared on the creating call,
   * so the tool may ask it something while the task runs.
   */
  elicitation?: Record<string, unknown>;
  /**
   * How long the task and its result are kept, from its creation.
   */
  ttlMs: number;
}

export type McpTaskStatus =
  | "working"
  | "input_required"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A task as `tasks/get` reports it.
 */
export interface McpTaskState {
  id: string;
  clientKey: string;
  status: McpTaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  /**
   * The tool's result, once `completed`.
   */
  result?: McpToolCallResult;
  /**
   * Why it `failed`.
   */
  error?: { code: number; message: string };
  /**
   * What an `input_required` task waits on, keyed as `tasks/update` must
   * answer it, each a server-to-client request.
   */
  inputRequests?: Record<string, unknown>;
}

/**
 * What the worker of a task hands `McpServerProvider.runTask`.
 */
export interface McpTaskRun {
  tool: string;
  arguments: Record<string, unknown>;
  clientKey: string;
  data?: unknown;
  elicitation?: Record<string, unknown>;
  /**
   * The task's id, which also seeds a URL elicitation's id.
   */
  taskId: string;
  /**
   * The answers to every input round so far, keyed `e0`, `e1`, ...
   */
  answers: Record<string, unknown>;
  signal?: AbortSignal;
}
