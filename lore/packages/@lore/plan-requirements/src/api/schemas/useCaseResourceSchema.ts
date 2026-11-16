import { type Infer, z } from "alepha";

import { useCaseActors } from "../entities/useCaseActors.ts";
import { useCaseAlternatives } from "../entities/useCaseAlternatives.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import { useCaseSteps } from "../entities/useCaseSteps.ts";
import { criterionResultSchema } from "./criterionResultSchema.ts";
import { runBySchema } from "./runBySchema.ts";
import { useCaseRunStateSchema } from "./useCaseRunStateSchema.ts";

/**
 * A use case as every surface reads it (#E153): the row, its actors with
 * their persona's number and name, its steps, alternatives and criteria in
 * order, and the epics covering it.
 */
export const useCaseResourceSchema = useCases.schema
  .omit({ deletedAt: true })
  .extend({
    actors: z.array(
      useCaseActors.schema.pick({ personaId: true, role: true }).extend({
        number: z.integer(),
        name: z.string(),
      }),
    ),
    steps: z.array(
      useCaseSteps.schema.pick({
        id: true,
        position: true,
        actorPersonaId: true,
        text: true,
      }),
    ),
    alternatives: z.array(
      useCaseAlternatives.schema.pick({ id: true, key: true, text: true }),
    ),
    criteria: z.array(
      useCaseCriteria.schema.omit({ useCaseId: true }).extend({
        /**
         * The number of the requirement it verifies (`#S15`), when it does.
         */
        requirementNumber: z.integer().optional(),
      }),
    ),
    /**
     * Where the use case stands from its latest run (#Q3770), and whether
     * that run is stale.
     */
    state: useCaseRunStateSchema,
    stale: z.boolean(),
    lastRun: z
      .object({
        id: z.integer(),
        ranAt: z.datetime(),
        by: runBySchema,
        client: z.string().optional(),
        app: z.string().optional(),
        env: z.string().optional(),
        results: z.array(
          z.object({
            key: z.string(),
            result: criterionResultSchema,
            note: z.string().optional(),
          }),
        ),
      })
      .optional(),
    coveredBy: z.array(
      z.object({
        id: z.integer(),
        number: z.integer(),
        title: z.string(),
        status: z.string().optional(),
        /**
         * The epic's quests done and in all, for development progress.
         */
        progress: z
          .object({ completed: z.integer(), total: z.integer() })
          .optional(),
      }),
    ),
  });

export type UseCaseResource = Infer<typeof useCaseResourceSchema>;
