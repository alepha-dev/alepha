import { $inject, Alepha, t } from "alepha";
import {
  AuditService,
  audits as auditEntity,
  auditResourceSchema,
} from "alepha/api/audits";
import {
  $job,
  JobService,
  jobExecutionEntity,
  jobExecutionQuerySchema,
  jobExecutionResourceSchema,
  jobRegistrationSchema,
} from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { $action, BadRequestError, okSchema } from "alepha/server";
import { PlaygroundAudits } from "./PlaygroundAudits.ts";
import { PlaygroundJobs } from "./PlaygroundJobs.ts";
import { PlaygroundNotifications } from "./PlaygroundNotifications.ts";

/**
 * HTTP surface exposed to the browser. Each endpoint exercises one feature
 * of $job so you can click around and watch it work.
 *
 * All endpoints return `okSchema` — the UI polls the admin API for actual data.
 */
export class PlaygroundController {
  protected readonly alepha = $inject(Alepha);
  protected readonly jobs = $inject(PlaygroundJobs);
  protected readonly jobService = $inject(JobService);
  protected readonly executions = $repository(jobExecutionEntity);
  protected readonly audits = $inject(PlaygroundAudits);
  protected readonly auditService = $inject(AuditService);
  protected readonly auditRepo = $repository(auditEntity);
  protected readonly notifications = $inject(PlaygroundNotifications);

  // --- Unauthenticated read proxies (the admin API requires permissions) ---

  public readonly playgroundListJobs = $action({
    method: "GET",
    path: "/playground/jobs",
    schema: { response: t.array(jobRegistrationSchema) },
    handler: () => this.jobService.listJobs(),
  });

  public readonly playgroundReset = $action({
    method: "POST",
    path: "/playground/reset",
    schema: {
      response: t.object({ ok: t.boolean(), deleted: t.integer() }),
    },
    handler: async () => {
      const rows = await this.executions.findMany({
        columns: ["id"] as any,
      });
      if (rows.length === 0) return { ok: true, deleted: 0 };
      const ids = rows.map((r) => r.id);
      await this.executions.deleteMany({ id: { inArray: ids } });
      return { ok: true, deleted: ids.length };
    },
  });

  public readonly playgroundJobSample = $action({
    method: "GET",
    path: "/playground/jobs/:name/sample",
    schema: {
      params: t.object({ name: t.text() }),
      response: t.object({
        sample: t.optional(t.record(t.text(), t.any())),
      }),
    },
    handler: ({ params }) => {
      const prim = this.alepha
        .primitives($job)
        .find((j) => j.name === params.name);
      if (!prim) return { sample: undefined };
      const opts = (prim as unknown as { options: { schema?: unknown } })
        .options;
      if (!opts.schema) return { sample: undefined };
      return { sample: sampleFromSchema(opts.schema) ?? undefined };
    },
  });

  public readonly playgroundListExecutions = $action({
    method: "GET",
    path: "/playground/jobs/:name/executions",
    schema: {
      params: t.object({ name: t.text() }),
      query: jobExecutionQuerySchema,
      response: t.array(jobExecutionResourceSchema),
    },
    handler: ({ params, query }) =>
      this.jobService.getExecutions(params.name, query),
  });

  // --- Cron ---

  public readonly triggerDailyCron = $action({
    method: "POST",
    path: "/playground/cron/daily",
    schema: { response: okSchema },
    handler: async () => {
      await this.jobs.dailyTick.trigger();
      return { ok: true };
    },
  });

  public readonly triggerHourlyCron = $action({
    method: "POST",
    path: "/playground/cron/hourly",
    schema: { response: okSchema },
    handler: async () => {
      await this.jobs.hourlyTick.trigger();
      return { ok: true };
    },
  });

  public readonly triggerBoomCron = $action({
    method: "POST",
    path: "/playground/cron/boom",
    schema: { response: okSchema },
    handler: async () => {
      await this.jobs.boomCron.trigger();
      return { ok: true };
    },
  });

  // --- Queue: single push ---

  public readonly pushMail = $action({
    method: "POST",
    path: "/playground/queue/mail",
    schema: {
      body: t.object({
        to: t.string({ format: "email" }),
        subject: t.string(),
      }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      await this.jobs.sendMail.push(body);
      return { ok: true };
    },
  });

  // --- Queue: pushMany ---

  public readonly pushManyMarketing = $action({
    method: "POST",
    path: "/playground/queue/marketing/bulk",
    schema: {
      body: t.object({ count: t.integer({ minimum: 1, maximum: 1000 }) }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      const items = Array.from({ length: body.count }, (_, i) => ({
        payload: {
          to: `user${i}@example.com`,
          campaign: "spring-sale",
        },
      }));
      await this.jobs.sendMarketing.pushMany(items);
      return { ok: true };
    },
  });

  // --- Queue: delay ---

  public readonly pushDelayed = $action({
    method: "POST",
    path: "/playground/queue/delayed",
    schema: {
      body: t.object({
        to: t.string({ format: "email" }),
        delaySeconds: t.integer({ minimum: 1, maximum: 3600 }),
      }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      await this.jobs.sendMail.push(
        { to: body.to, subject: `Delayed by ${body.delaySeconds}s` },
        { delay: [body.delaySeconds, "seconds"] },
      );
      return { ok: true };
    },
  });

  // --- Queue: key-based dedup ---

  public readonly pushDeduped = $action({
    method: "POST",
    path: "/playground/queue/deduped",
    schema: {
      body: t.object({ key: t.string() }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      await this.jobs.sendMail.push(
        { to: "dedup@example.com", subject: `Keyed: ${body.key}` },
        { key: body.key, delay: [1, "hour"] },
      );
      return { ok: true };
    },
  });

  // --- Queue: priority ---

  public readonly pushPriority = $action({
    method: "POST",
    path: "/playground/queue/priority",
    schema: {
      body: t.object({
        priority: t.enum(["critical", "high", "normal", "low"]),
      }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      await this.jobs.sendMail.push(
        {
          to: `${body.priority}@example.com`,
          subject: `Priority ${body.priority}`,
        },
        { priority: body.priority, delay: [1, "hour"] },
      );
      return { ok: true };
    },
  });

  // --- Queue: force a failure and watch retries ---

  public readonly pushFlaky = $action({
    method: "POST",
    path: "/playground/queue/flaky",
    schema: { response: okSchema },
    handler: async () => {
      await this.jobs.flaky.push({
        v: Math.floor(Math.random() * 1000),
      });
      return { ok: true };
    },
  });

  // --- Queue: slow task (for cancel / timeout) ---

  public readonly pushSlow = $action({
    method: "POST",
    path: "/playground/queue/slow",
    schema: {
      body: t.object({ label: t.string() }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      await this.jobs.slow.push(body);
      return { ok: true };
    },
  });

  public readonly cancelSlow = $action({
    method: "POST",
    path: "/playground/executions/:id/cancel",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.jobs.slow.cancel(params.id);
      return { ok: true };
    },
  });

  // --- Generic run endpoint used by the Ops page ---

  public readonly runAnyJob = $action({
    method: "POST",
    path: "/playground/run",
    schema: {
      body: t.object({
        name: t.text(),
        payload: t.optional(t.record(t.text(), t.any())),
        delaySeconds: t.optional(t.integer({ minimum: 1, maximum: 86_400 })),
        key: t.optional(t.text()),
        priority: t.optional(t.enum(["critical", "high", "normal", "low"])),
      }),
      response: okSchema,
    },
    handler: async ({ body }) => {
      const prim = this.alepha
        .primitives($job)
        .find((j) => j.name === body.name);
      if (!prim) {
        throw new BadRequestError(`Unknown job: ${body.name}`);
      }

      const opts = (prim as unknown as { options: { schema?: unknown } })
        .options;
      const isQueue = Boolean(opts.schema);

      if (!isQueue) {
        // cron-style manual trigger — payload/delay/key/priority ignored
        await prim.trigger();
        return { ok: true };
      }

      if (!body.payload) {
        throw new BadRequestError("Queue jobs require a payload");
      }
      await prim.push(body.payload, {
        delay: body.delaySeconds
          ? ([body.delaySeconds, "seconds"] as [number, "seconds"])
          : undefined,
        key: body.key || undefined,
        priority: body.priority,
      });
      return { ok: true };
    },
  });

  public readonly cancelAny = $action({
    method: "POST",
    path: "/playground/executions-any/:id/cancel",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.jobService.cancelExecution(params.id);
      return { ok: true };
    },
  });

  public readonly retryAny = $action({
    method: "POST",
    path: "/playground/executions-any/:id/retry",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.jobService.retryExecution(params.id);
      return { ok: true };
    },
  });

  // --- Audits ---------------------------------------------------------------

  public readonly auditLogin = $action({
    method: "POST",
    path: "/playground/audits/login",
    schema: { response: okSchema },
    handler: async () => {
      await this.audits.auth.log("login", {
        userId: "00000000-0000-0000-0000-000000000001",
        description: "playground login",
        success: true,
      });
      return { ok: true };
    },
  });

  public readonly auditFailedLogin = $action({
    method: "POST",
    path: "/playground/audits/failed-login",
    schema: { response: okSchema },
    handler: async () => {
      await this.audits.auth.log("failed-login", {
        description: "bad credentials",
        success: false,
        severity: "warning",
      });
      return { ok: true };
    },
  });

  public readonly auditOrder = $action({
    method: "POST",
    path: "/playground/audits/order",
    schema: { response: okSchema },
    handler: async () => {
      await this.audits.orders.log("create", {
        resourceType: "order",
        resourceId: `ord_${Math.random().toString(36).slice(2, 10)}`,
        description: "order created",
        metadata: { total: 120.5, currency: "EUR" },
      });
      return { ok: true };
    },
  });

  public readonly auditAccessDenied = $action({
    method: "POST",
    path: "/playground/audits/access-denied",
    schema: { response: okSchema },
    handler: async () => {
      await this.audits.security.log("access-denied", {
        description: "forbidden resource",
        severity: "critical",
        success: false,
      });
      return { ok: true };
    },
  });

  public readonly playgroundListAudits = $action({
    method: "GET",
    path: "/playground/audits",
    schema: {
      response: t.array(auditResourceSchema),
    },
    handler: async () => {
      const page = await this.auditService.find({
        page: 1,
        size: 50,
        sort: "-createdAt",
      });
      return page.content as any;
    },
  });

  public readonly playgroundResetAudits = $action({
    method: "POST",
    path: "/playground/audits/reset",
    schema: {
      response: t.object({ ok: t.boolean(), deleted: t.integer() }),
    },
    handler: async () => {
      const rows = await this.auditRepo.findMany({ columns: ["id"] as any });
      if (rows.length === 0) return { ok: true, deleted: 0 };
      const ids = rows.map((r) => r.id);
      await this.auditRepo.deleteMany({ id: { inArray: ids } });
      return { ok: true, deleted: ids.length };
    },
  });

  // --- Notifications --------------------------------------------------------

  public readonly pushWelcomeEmail = $action({
    method: "POST",
    path: "/playground/notifications/welcome",
    schema: { response: okSchema },
    handler: async () => {
      await this.notifications.welcomeEmail.push({
        contact: "alice@example.com",
        variables: { username: "Alice" },
      });
      return { ok: true };
    },
  });

  public readonly pushPasswordReset = $action({
    method: "POST",
    path: "/playground/notifications/reset",
    schema: { response: okSchema },
    handler: async () => {
      await this.notifications.passwordReset.push({
        contact: "alice@example.com",
        variables: {
          username: "Alice",
          link: "https://example.com/reset/abc123",
        },
      });
      return { ok: true };
    },
  });

  public readonly pushMarketingBlast = $action({
    method: "POST",
    path: "/playground/notifications/marketing",
    schema: { response: okSchema },
    handler: async () => {
      await this.notifications.marketingBlast.push({
        contact: "alice@example.com",
        variables: { campaign: "spring-sale-2026" },
      });
      return { ok: true };
    },
  });
}

/**
 * Walk a TypeBox schema and emit a placeholder value for every field.
 * Strings → "string", numbers → 0, booleans → true, arrays → [sample of item],
 * objects → recurse, unions → first variant, enum → first value.
 */
function sampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as Record<string, unknown>;

  // TypeBox Optional wraps the inner schema in s[Symbol.for("TypeBox.Kind")] = "Optional"
  // but properties of objects already have the inner type — we just include every
  // property regardless of required/optional to give users a ready-to-edit shape.

  if (s.enum && Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if ("const" in s) return s.const;

  const type = s.type;
  if (type === "string") {
    if (s.format === "email") return "user@example.com";
    if (s.format === "uri" || s.format === "url") return "https://example.com";
    if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (s.format === "date-time") return new Date().toISOString();
    return "string";
  }
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return true;
  if (type === "null") return null;
  if (type === "array") return [sampleFromSchema(s.items)];
  if (type === "object") {
    const out: Record<string, unknown> = {};
    const props = (s.properties ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      out[k] = sampleFromSchema(v);
    }
    return out;
  }

  if (Array.isArray(s.anyOf) && s.anyOf.length > 0)
    return sampleFromSchema(s.anyOf[0]);
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0)
    return sampleFromSchema(s.oneOf[0]);
  if (Array.isArray(s.allOf) && s.allOf.length > 0)
    return sampleFromSchema(s.allOf[0]);

  return null;
}
