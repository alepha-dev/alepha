import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { promptArgSchema } from "../schemas/promptArgSchema.ts";
import {
  PROMPT_MAX_ARGS,
  PROMPT_NAME_PATTERN,
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
 * Trigger columns come with the triggers quest, pins with the pins quest,
 * each with its migration.
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
  }),
  indexes: [{ columns: ["projectId", "name"], unique: true }],
});

export type Prompt = Infer<typeof prompts.schema>;
