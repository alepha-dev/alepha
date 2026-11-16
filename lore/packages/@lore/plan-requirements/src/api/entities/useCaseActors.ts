import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { actorRoleSchema } from "../schemas/actorRoleSchema.ts";
import { personas } from "./personas.ts";
import { useCases } from "./useCases.ts";

/**
 * Who plays a use case, and how (#E153). The truth of the edge: an `actor`
 * row in `folio_links` mirrors it (persona to use case, no role) for
 * backlinks, written after this table, best effort.
 */
export const useCaseActors = $entity({
  name: "use_case_actors",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    useCaseId: db.ref(z.integer(), () => useCases.cols.id, {
      onDelete: "cascade",
    }),
    personaId: db.ref(z.integer(), () => personas.cols.id, {
      onDelete: "cascade",
    }),
    role: db.default(actorRoleSchema.meta({ mode: "text" }), "primary"),
  }),
  indexes: [{ columns: ["useCaseId", "personaId"], unique: true }],
});

export type UseCaseActor = Infer<typeof useCaseActors.schema>;
