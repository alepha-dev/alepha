import { projects } from "@lore/core/schemas";
import { epics } from "@lore/plan/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * An epic marked technical (#E153, #Q3774): it covers no use case on
 * purpose (a migration, a logging change), so the coverage gaps leave it
 * out. The package's own row keyed by epic id, never a column on Plan's
 * `epics` table.
 */
export const technicalEpics = $entity({
  name: "requirement_technical_epics",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    epicId: db.ref(z.integer(), () => epics.cols.id, {
      onDelete: "cascade",
    }),
  }),
  indexes: [{ columns: ["epicId"], unique: true }],
});

export type TechnicalEpic = Infer<typeof technicalEpics.schema>;
