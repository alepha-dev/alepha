import { $inject, z } from "alepha";
import type { DevEntityMetadata } from "alepha/inspector";
import { $tool } from "alepha/mcp";

import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * `alepha mcp`: the selected app's database rows, read only, and its jobs.
 *
 * Rows go into a model's context, so every column the entity marks
 * `secret: true` comes back as `"[redacted]"`, with no opt-out, and cannot
 * be filtered on. No tool here reaches the inspector's row writes
 * (`dbCreate`, `dbUpdate`, `dbDelete`).
 */
export class DevMcpDataTools {
  protected readonly session = $inject(DevMcpSession);

  /**
   * What a secret column's value reads as: the logger's own placeholder.
   */
  protected readonly redacted = "[redacted]";

  public readonly dbRows = $tool({
    name: "db_rows",
    description:
      'Rows of one of the selected app\'s entities (app_map lists them), read only: an equality filter, a sort and a size. Columns the entity marks secret come back as "[redacted]" and cannot be filtered on.',
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        entity: z.text().describe("The entity's name, as app_map prints it"),
        where: z
          .record(z.text(), z.union([z.text(), z.number(), z.boolean()]))
          .describe('Column to value, equality only: { "status": "open" }')
          .optional(),
        sort: z
          .text()
          .describe('A column, "-column" for descending; comma-separated')
          .optional(),
        size: z.integer().min(1).max(100).describe("Default 10").optional(),
        page: z.integer().min(0).describe("From 0").optional(),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const { connection } = target;

      const meta = await connection.call("metadata");
      const entity = meta.entities.find((e) => e.name === params.entity);
      if (!entity) {
        return `No entity "${params.entity}". Entities: ${meta.entities
          .map((e) => e.name)
          .join(", ")}.`;
      }
      const secret = this.secretColumns(entity);
      const probed = Object.keys(params.where ?? {}).filter((column) =>
        secret.has(column),
      );
      if (probed.length) {
        return `Refused: ${probed.join(", ")} ${probed.length > 1 ? "are" : "is"} secret, and a filter on a secret column would reveal its value.`;
      }

      const response = await connection.request(
        "GET",
        `/db/${encodeURIComponent(entity.name)}/records?${new URLSearchParams({
          size: String(params.size ?? 10),
          page: String(params.page ?? 0),
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.where ? { where: JSON.stringify(params.where) } : {}),
        }).toString()}`,
      );
      if (response.status !== 200) {
        return `Not read: ${
          (response.body as { message?: string } | undefined)?.message ??
          `the inspector answered ${response.status}`
        }`;
      }

      const page = response.body as {
        content?: Array<Record<string, unknown>>;
        page?: { totalElements?: number; number?: number; totalPages?: number };
      };
      const rows = (page.content ?? []).map((row) => this.redact(row, secret));
      const total = page.page?.totalElements;
      const head = `${rows.length} row${rows.length === 1 ? "" : "s"}${
        total !== undefined ? ` of ${total}` : ""
      } from ${entity.name}${params.page ? `, page ${params.page}` : ""}${
        secret.size ? ` (${[...secret].join(", ")} redacted)` : ""
      }`;
      return [head, ...rows.map((row) => JSON.stringify(row))].join("\n");
    },
  });

  public readonly jobsList = $tool({
    name: "jobs_list",
    description:
      "The selected app's jobs ($job) with their runtime state: counts by outcome, last run, schedule. app_describe kind job gives one's payload type.",
    annotations: { readOnlyHint: true },
    handler: async () => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const { jobs } = (await target.connection.call("jobs")) as {
        jobs?: unknown[];
      };
      if (!jobs?.length)
        return "This app declares no job, or does not load alepha/api/jobs.";
      return jobs.map((job) => `- ${JSON.stringify(job)}`).join("\n");
    },
  });

  public readonly jobExecutions = $tool({
    name: "job_executions",
    description:
      "The newest executions of one job (up to 100), optionally of one status: id, status, attempt, times and error.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        job: z.text().describe("The job's name"),
        status: z
          .text()
          .describe("pending, scheduled, running, ok, error, cancelled...")
          .optional(),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const response = await target.connection.request(
        "GET",
        `/jobs/${encodeURIComponent(params.job)}/executions${
          params.status ? `?status=${encodeURIComponent(params.status)}` : ""
        }`,
      );
      if (response.status !== 200) {
        return `Not read: ${(response.body as { message?: string })?.message ?? response.status}`;
      }
      const { executions } = response.body as { executions?: unknown[] };
      if (!executions?.length) return `No execution of "${params.job}".`;
      return executions.map((row) => `- ${JSON.stringify(row)}`).join("\n");
    },
  });

  public readonly jobTrigger = $tool({
    name: "job_trigger",
    description:
      "Run one of the selected app's jobs now, with a payload for a queue job (its type is in app_describe kind job). Then job_executions shows the run and logs_tail what it logged.",
    annotations: { destructiveHint: true },
    schema: {
      params: z.object({
        job: z.text().describe("The job's name"),
        payload: z
          .record(z.text(), z.any())
          .describe("The job's payload, for a queue job")
          .optional(),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const response = await target.connection.request(
        "POST",
        `/jobs/${encodeURIComponent(params.job)}/trigger`,
        {
          ...(params.payload ? { payload: params.payload } : {}),
          triggeredByName: "alepha mcp",
        },
      );
      return this.outcome(response, `Triggered "${params.job}".`);
    },
  });

  public readonly jobRetry = $tool({
    name: "job_retry",
    description:
      "Retry one failed or cancelled job execution, by the id job_executions gives.",
    annotations: { destructiveHint: true },
    schema: {
      params: z.object({ execution: z.text().describe("The execution's id") }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const response = await target.connection.request(
        "POST",
        `/jobs/executions/${encodeURIComponent(params.execution)}/retry`,
      );
      return this.outcome(response, `Retrying execution ${params.execution}.`);
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected secretColumns(entity: DevEntityMetadata): Set<string> {
    return new Set(
      entity.columns.filter((column) => column.secret).map((c) => c.name),
    );
  }

  protected redact(
    row: Record<string, unknown>,
    secret: Set<string>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] =
        secret.has(key) && value !== null && value !== undefined
          ? this.redacted
          : value;
    }
    return out;
  }

  /**
   * A job route's answer as a sentence: a 4xx/5xx status, or an `error` the
   * route returns in a 200 when the jobs module is not loaded.
   */
  protected outcome(
    response: { status: number; body: unknown },
    done: string,
  ): string {
    const body = response.body as
      | { message?: string; error?: string }
      | undefined;
    if (response.status !== 200) {
      return `Failed: ${body?.message ?? `the inspector answered ${response.status}`}`;
    }
    if (body?.error) return `Failed: ${body.error}`;
    return done;
  }
}
