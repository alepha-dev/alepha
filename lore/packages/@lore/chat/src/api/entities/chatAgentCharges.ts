import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * What a project's AI budget paid for (#Q4237): one row per chat agent run
 * charged to the project, with the tokens it spent.
 *
 * The run's messages stay the mentioner's (`ai_messages`), since the
 * mentioner alone may approve its writes; their own budget subtracts these
 * rows, so a run the project paid for is not counted twice.
 */
export const chatAgentCharges = $entity({
  name: "chat_agent_charges",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The member who mentioned the agent. Not a reference: the row outlives
     * an account, and the sum it feeds is by id.
     */
    userId: z.uuid(),
    conversationId: z.uuid().optional(),
    tokens: z.integer().min(0),
  }),
  indexes: [
    { columns: ["projectId", "createdAt"] },
    { columns: ["userId", "createdAt"] },
  ],
});

export type ChatAgentCharge = Infer<typeof chatAgentCharges.schema>;
