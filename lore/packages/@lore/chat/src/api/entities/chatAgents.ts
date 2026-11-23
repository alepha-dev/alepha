import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * A project's own chat agent (#E170, #Q4196): a persona with a playbook,
 * answered by the same engine as `@lore`, with the mentioner's rights.
 *
 * ⚠️ Deleting one is a soft delete: `deletedAt` set and `handle` cleared, so
 * the handle is free again while the row and its avatar stay, and the
 * answers it gave still render with its name and avatar. Two deleted agents
 * of a project both have a null handle, and nulls are distinct in a unique
 * index on SQLite and Postgres alike: no partial index is needed.
 */
export const chatAgents = $entity({
  name: "chat_agents",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * What a message mentions, `jarvis`. Null once deleted.
     */
    handle: z.text({ maxLength: 32 }).optional(),
    /**
     * The display name, "Jarvis".
     */
    name: z.text({ minLength: 1, maxLength: 60 }),
    /**
     * An image in the `chat-agent-avatars` bucket, or none: the page draws
     * initials on a colour.
     */
    avatar: z.uuid().optional(),
    /**
     * The persona and its playbook, Markdown, appended after the base
     * system prompt of every run.
     */
    prePrompt: z.text({ size: "rich" }),
    /**
     * A model id, or none for the instance default.
     */
    model: z.text({ maxLength: 120 }).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    deletedAt: z.datetime().optional(),
  }),
  indexes: [{ columns: ["projectId", "handle"], unique: true }],
});

export type ChatAgent = Infer<typeof chatAgents.schema>;
