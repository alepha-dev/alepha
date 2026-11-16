import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { criterionMethodSchema } from "../schemas/criterionMethodSchema.ts";
import { useCases } from "./useCases.ts";

/**
 * An acceptance criterion of a use case (`C2`, #E153): Given / When / Then
 * by default, free text accepted, how it is verified, the alternative it
 * belongs to, and the requirement it verifies.
 *
 * ⚠️ `key` is assigned once from `use_cases.criterionSeq` and never reused:
 * deleting `C2` leaves a gap, and reordering renumbers nothing.
 */
export const useCaseCriteria = $entity({
  name: "use_case_criteria",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    useCaseId: db.ref(z.integer(), () => useCases.cols.id, {
      onDelete: "cascade",
    }),
    key: z.string().min(2).max(10),
    position: z.integer().min(1),
    givenText: z.string().max(2000).optional(),
    whenText: z.string().max(2000).optional(),
    thenText: z.string().max(2000).optional(),
    /**
     * A criterion written as one sentence rather than Given / When / Then.
     */
    text: z.string().max(2000).optional(),
    method: db.default(criterionMethodSchema.meta({ mode: "text" }), "manual"),
    /**
     * The alternative it belongs to (`4a`), or none for the main flow.
     */
    alternativeKey: z.string().max(10).optional(),
    /**
     * The requirement it verifies, once requirements exist (#Q3768).
     */
    requirementId: z.integer().optional(),
  }),
  indexes: [{ columns: ["useCaseId", "key"], unique: true }],
});

export type UseCaseCriterion = Infer<typeof useCaseCriteria.schema>;
