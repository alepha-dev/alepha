import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { useCases } from "./useCases.ts";

/**
 * An alternative path of a use case (`4a. Expired code`, #E153), kept inside
 * it with its own criteria.
 */
export const useCaseAlternatives = $entity({
  name: "use_case_alternatives",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    useCaseId: db.ref(z.integer(), () => useCases.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * `4a`: the step it branches from and a letter.
     */
    key: z.string().min(1).max(10),
    position: z.integer().min(1),
    text: z.string().meta({ size: "rich" }),
  }),
  indexes: [{ columns: ["useCaseId", "position"] }],
});

export type UseCaseAlternative = Infer<typeof useCaseAlternatives.schema>;
