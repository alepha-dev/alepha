import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import {
  AUTOMATION_NAME_PATTERN,
  AUTOMATION_PROMPT_KINDS,
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
    agent: z.string().max(32).optional(),
    model: z.string().max(96).optional(),
    trigger: db.default(
      z.enum(AUTOMATION_TRIGGERS).meta({ mode: "text" }),
      "manual",
    ),
    /**
     * Run only when Lore finds something to do first (#Q4228), so an idle
     * project spends no tokens. A run by hand ignores it.
     */
    onlyIfWork: db.default(z.boolean(), false),
    /** The last job a run started. A soft reference, read by id. */
    lastJobId: z.uuid().optional(),
    lastRunAt: z.string().optional(),
    /** Failed or timed-out jobs in a row (#Q4230). */
    consecutiveFailures: db.default(z.integer().min(0), 0),
  }),
  indexes: [{ columns: ["projectId", "name"], unique: true }],
});

export type AgentAutomation = Infer<typeof agentAutomations.schema>;
