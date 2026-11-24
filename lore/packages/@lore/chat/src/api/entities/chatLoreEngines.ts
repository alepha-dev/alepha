import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * `@lore`'s AI provider in a project (#Q4250): absent is `api`, the instance's
 * model (`AI_MODEL`, which an environment variable chooses for every project
 * at once and so cannot name a project's host). A row with `engine: host`
 * runs its turns on an Agent host of the project instead, like a project
 * agent's own `engine`.
 */
export const chatLoreEngines = $entity({
  name: "chat_lore_engines",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    engine: db.default(z.enum(["api", "host"]).meta({ mode: "text" }), "api"),
    engineHost: z.text({ maxLength: 64 }).optional(),
    engineAgent: z.text({ maxLength: 32 }).optional(),
    engineModel: z.text({ maxLength: 80 }).optional(),
  }),
  indexes: [{ columns: ["projectId"], unique: true }],
});

export type ChatLoreEngine = Infer<typeof chatLoreEngines.schema>;
