import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { promptArgSchema } from "../schemas/promptArgSchema.ts";
import {
  PROMPT_CHECKS,
  PROMPT_MAX_ARGS,
  PROMPT_NAME_PATTERN,
  PROMPT_SCHEDULES,
  PROMPT_SOURCES,
} from "../schemas/promptValues.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * A project's prompts (#E174, #Q4274): one table for what were project
 * prompt overrides (#E41) and agent automations (#E172).
 *
 * Two kinds of row:
 *
 * - **A custom prompt**: its own name, title, description, text and args.
 * - **A row configuring a built-in** (`builtin` set): its name is the
 *   built-in's, and it holds no text and no args, which come from the
 *   server's registry at each read, so the project keeps following Lore's
 *   text as it improves. Only what a project may change is stored: the
 *   source, where it runs, enabled. A built-in with no row is still listed.
 *
 * `createdBy` is the owner, whose rank bounds the jobs a trigger starts.
 *
 * **Triggers** (#Q4277, from E172's automations): project events, a
 * schedule, or both; `check` asked before a triggered run; a stored value
 * per arg the trigger does not fill; ceilings; self-disable after three
 * failed runs in a row. A built-in's trigger is writable (its text is not),
 * and writing it creates its row.
 */
export const prompts = $entity({
  name: "prompts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().regex(PROMPT_NAME_PATTERN),
    /**
     * Set on a row configuring the built-in of the same name.
     */
    builtin: db.default(z.boolean(), false),
    enabled: db.default(z.boolean(), true),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    title: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    /**
     * A custom prompt's words, with `{{name}}` and `{{arg.field}}`
     * placeholders. `z.string()`, never `z.text()`, which caps at 255.
     */
    text: z.string().max(131_072).optional(),
    args: z.array(promptArgSchema).max(PROMPT_MAX_ARGS).optional(),
    /**
     * The prompt's own source, never chosen at a run: on a built-in's row it
     * overrides the registry's.
     */
    source: z.enum(PROMPT_SOURCES).meta({ mode: "text" }).optional(),
    ref: z.string().max(200).optional(),
    host: z.string().max(64).optional(),
    agent: z.string().max(32).optional(),
    model: z.string().max(96).optional(),
    /**
     * The project events it listens to, catalog keys.
     */
    eventKeys: z.array(z.string().max(64)).max(16).optional(),
    /**
     * How long a run of a prompt with no args waits after a burst's first
     * event, so the burst lands in one run. Seconds.
     */
    settleSeconds: db.default(z.integer().min(0).max(3600), 60),
    /**
     * An event arrived and its run has not started yet, and the job that
     * raised it, when a job did (the chain guard reads it).
     */
    pending: db.default(z.boolean(), false),
    pendingJobId: z.uuid().optional(),
    schedule: z.enum(PROMPT_SCHEDULES).meta({ mode: "text" }).optional(),
    /**
     * A daily or weekly schedule's hour, and a weekly one's day
     * (`getUTCDay`), in UTC.
     */
    dailyHour: z.integer().min(0).max(23).optional(),
    weekday: z.integer().min(0).max(6).optional(),
    /**
     * When the hourly job runs it next. A missed tick is not replayed.
     */
    nextRunAt: z.string().optional(),
    check: z.array(z.enum(PROMPT_CHECKS)).max(4).optional(),
    /**
     * A stored value per arg the trigger does not fill: a member for a
     * weekly status, an epic.
     */
    argValues: z.record(z.string().max(32), z.string().max(120)).optional(),
    /**
     * The pages it is pinned to (#Q4284), by key: none by default.
     */
    pins: z.array(z.string().max(32)).max(16).optional(),
    maxRunsPerHour: db.default(z.integer().min(1).max(60), 6),
    maxRunsPerDay: db.default(z.integer().min(1).max(1000), 48),
    consecutiveFailures: db.default(z.integer().min(0), 0),
    /**
     * The last job a run started, and when; the last run a trigger asked
     * for that started nothing, and why.
     */
    lastJobId: z.uuid().optional(),
    lastRunAt: z.string().optional(),
    lastSkippedAt: z.string().optional(),
    lastSkippedReason: z.string().max(500).optional(),
  }),
  indexes: [
    { columns: ["projectId", "name"], unique: true },
    // The hourly check: every prompt due, across projects.
    { columns: ["nextRunAt"] },
  ],
});

export type Prompt = Infer<typeof prompts.schema>;
