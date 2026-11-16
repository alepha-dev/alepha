import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { useCases } from "./useCases.ts";

/**
 * One step of a use case's scenario (#E153), in order, with the persona who
 * acts it, or none for the system.
 *
 * `actorPersonaId` is a plain value, not a foreign key: a persona is soft
 * deleted, and a step keeps naming who it was.
 */
export const useCaseSteps = $entity({
  name: "use_case_steps",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    useCaseId: db.ref(z.integer(), () => useCases.cols.id, {
      onDelete: "cascade",
    }),
    position: z.integer().min(1),
    actorPersonaId: z.integer().optional(),
    text: z.string().meta({ size: "rich" }),
  }),
  indexes: [{ columns: ["useCaseId", "position"] }],
});

export type UseCaseStep = Infer<typeof useCaseSteps.schema>;
