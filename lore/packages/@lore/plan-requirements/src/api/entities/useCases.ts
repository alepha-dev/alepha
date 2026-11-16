import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { useCasePrioritySchema } from "../schemas/useCasePrioritySchema.ts";
import { useCaseStatusSchema } from "../schemas/useCaseStatusSchema.ts";

/**
 * A use case (`#U<n>`, #E153): a scenario played by personas, with ordered
 * steps, alternatives and acceptance criteria, covered by epics.
 */
export const useCases = $entity({
  name: "use_cases",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Per-project number, `#U<n>`, from `$sequence` under the property name
     * `useCaseNumber` on `UseCaseController`.
     */
    number: z.integer().min(1),
    title: z.string().min(3).max(120),
    status: db.default(useCaseStatusSchema.meta({ mode: "text" }), "draft"),
    priority: db.default(
      useCasePrioritySchema.meta({ mode: "text" }),
      "medium",
    ),
    preconditions: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * A seed path the agent or the CI runs before the scenario.
     */
    startingData: z.string().max(300).optional(),
    /**
     * The e2e spec playing this use case, and its tag (`@U7`).
     */
    automatedTestPath: z.string().max(300).optional(),
    automatedTestTag: z.string().max(60).optional(),
    /**
     * Bumped by any edit of a step or a criterion: a run of an older version
     * is stale.
     */
    scenarioVersion: db.default(z.integer().min(1), 1),
    /**
     * The last criterion key handed out (`C<n>`). ⚠️ Only ever grows: a key
     * is assigned once and never reused, since runs, errors and the
     * Playwright reporter name a criterion by `(use case, key)`.
     */
    criterionSeq: db.default(z.integer().min(0), 0),
  }),
  indexes: [{ columns: ["projectId", "number"], unique: true }],
});

export type UseCase = Infer<typeof useCases.schema>;
