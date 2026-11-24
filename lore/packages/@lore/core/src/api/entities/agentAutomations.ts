import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import {
  AUTOMATION_NAME_PATTERN,
  AUTOMATION_PROMPT_KINDS,
  AUTOMATION_SCHEDULES,
  AUTOMATION_TRIGGERS,
} from "../schemas/agentAutomationValues.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * An agent automation (#E172, #Q4226): a prompt run on an Agent host, by
 * hand, on a project event or on a schedule. One row and nothing more: no
 * step, no branch, no condition language (folio #F1526 says why Lore's
 * earlier Automations were removed, and this stays far smaller).
 *
 * - **The owner** is `createdBy`: the member whose rank bounds every job key
 *   a run starts, and who is the job's starter on an event or a schedule, so
 *   an outside reporter is never the starter of anything.
 * - **Where it runs**: `host`, `agent` and `model`, each optional with the
 *   same rule as a run by hand (the project's only Agent host, the host's
 *   only agent, the CLI's default model). `host` is a slug, read at each run.
 * - Each run is a host job carrying `host_jobs.automationId`; one runs at a
 *   time per automation.
 *
 * Later columns come with the quests that read them, each with its
 * migration.
 */
export const agentAutomations = $entity({
  name: "agent_automations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().regex(AUTOMATION_NAME_PATTERN),
    enabled: db.default(z.boolean(), true),
    /**
     * The owner. An automation whose owner is gone runs nothing until a
     * member takes it over by editing it.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    promptKind: z.enum(AUTOMATION_PROMPT_KINDS).meta({ mode: "text" }),
    /** A `text` automation's words, under Lore's preamble. */
    promptText: z.string().max(131_072).optional(),
    host: z.string().max(64).optional(),
    /**
     * The Agent host's agent CLI; for a `chat` automation (#Q4236), the
     * handle of the project chat agent it runs.
     */
    agent: z.string().max(32).optional(),
    /**
     * A `chat` automation's room, by name (#Q4236), read at each run like
     * `host`: the agent answers there.
     */
    room: z.string().max(64).optional(),
    model: z.string().max(96).optional(),
    /**
     * The code its jobs find (#E173), as a run by hand asks for it: `none`,
     * `read` or `write`, and the ref. Absent, the prompt's default: a build
     * writes, every other kind reads the default branch.
     */
    source: z.enum(["none", "read", "write"]).meta({ mode: "text" }).optional(),
    ref: z.string().max(200).optional(),
    trigger: db.default(
      z.enum(AUTOMATION_TRIGGERS).meta({ mode: "text" }),
      "manual",
    ),
    /**
     * The project events an `event` automation listens to (#Q4227), keys of
     * the catalog (`feedback.created`, `quest.created`).
     */
    eventKeys: z.array(z.string().max(64)).max(16).optional(),
    /**
     * How long a run waits after the first event of a burst (#Q4227), so
     * the burst lands in one prompt. Seconds.
     */
    settleSeconds: db.default(z.integer().min(0).max(3600), 60),
    /**
     * An event arrived and its run has not started yet (#Q4227): waiting
     * out the settle delay, or for the running job to end. Ten events in a
     * minute set it once.
     */
    pending: db.default(z.boolean(), false),
    /**
     * The job that raised the pending event, when a job did: the run it
     * starts records it as its parent, which the chain guard reads.
     */
    pendingJobId: z.uuid().optional(),
    /**
     * A `schedule` automation's interval (#Q4228), and the hour of a daily
     * one, in UTC: Lore has no project time zone.
     */
    schedule: z.enum(AUTOMATION_SCHEDULES).meta({ mode: "text" }).optional(),
    dailyHour: z.integer().min(0).max(23).optional(),
    /**
     * When the hourly job runs it next (#Q4228). A tick missed while the
     * host was offline is not replayed: the next tick decides again.
     */
    nextRunAt: z.string().optional(),
    /**
     * The last run its trigger asked for and that started nothing, and why
     * (#Q4228): "it did not run" explained on its row.
     */
    lastSkippedAt: z.string().optional(),
    lastSkippedReason: z.string().max(500).optional(),
    /**
     * Run only when Lore finds something to do first (#Q4228), so an idle
     * project spends no tokens. A run by hand ignores it.
     */
    onlyIfWork: db.default(z.boolean(), false),
    /**
     * A build automation's pull requests ask for auto-merge through `gh`
     * (#Q4229); the repository's own protections decide the rest.
     */
    autoMerge: db.default(z.boolean(), false),
    /**
     * How many of its jobs a build automation runs at once (#Q4229), one
     * quest per job. Every other kind runs one: two triages at once would
     * race on the same inbox and workspace. Above the host's own limit the
     * extra jobs wait in its queue.
     */
    concurrency: db.default(z.integer().min(1).max(16), 1),
    /**
     * The most runs its trigger starts in an hour and in a day (#Q4230),
     * counted on the jobs with its id. A run by hand is never refused.
     */
    maxRunsPerHour: db.default(z.integer().min(1).max(60), 6),
    maxRunsPerDay: db.default(z.integer().min(1).max(1000), 48),
    /** The last job a run started. A soft reference, read by id. */
    lastJobId: z.uuid().optional(),
    lastRunAt: z.string().optional(),
    /** Failed or timed-out jobs in a row (#Q4230). */
    consecutiveFailures: db.default(z.integer().min(0), 0),
  }),
  indexes: [
    { columns: ["projectId", "name"], unique: true },
    // The hourly check's one query: what is due, across every project.
    { columns: ["nextRunAt"] },
  ],
});

export type AgentAutomation = Infer<typeof agentAutomations.schema>;
