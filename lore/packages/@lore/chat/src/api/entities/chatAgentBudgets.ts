import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * A project's AI budget for its chat agents (#Q4237): the tokens their runs
 * may spend over the instance's budget window (`api.ai`), before a run falls
 * back to the mentioner's own budget.
 *
 * One row per project at most; no row is no project budget, and every run is
 * the mentioner's, as before.
 */
export const chatAgentBudgets = $entity({
  name: "chat_agent_budgets",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    tokens: z.integer().min(1),
    updatedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [{ columns: ["projectId"], unique: true }],
});

export type ChatAgentBudget = Infer<typeof chatAgentBudgets.schema>;
