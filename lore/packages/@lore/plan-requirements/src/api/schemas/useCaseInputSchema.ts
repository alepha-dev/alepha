import { type Infer, z } from "alepha";

import { useCaseActors } from "../entities/useCaseActors.ts";
import { useCaseAlternatives } from "../entities/useCaseAlternatives.ts";
import { useCaseCriteria } from "../entities/useCaseCriteria.ts";
import { useCases } from "../entities/useCases.ts";
import { useCaseSteps } from "../entities/useCaseSteps.ts";

/**
 * What a create or an update writes on a use case (#E153). Each list,
 * when present, REPLACES the use case's own: steps and alternatives in the
 * order given; criteria keep their key when they carry one, and a criterion
 * without a key gets the next one, never a freed one.
 */
export const useCaseInputSchema = useCases.schema
  .pick({
    title: true,
    status: true,
    priority: true,
    preconditions: true,
    startingData: true,
    automatedTestPath: true,
    automatedTestTag: true,
  })
  .extend({
    actors: z.array(
      useCaseActors.schema.pick({ personaId: true, role: true }).partial({
        role: true,
      }),
    ),
    steps: z.array(
      useCaseSteps.schema.pick({ actorPersonaId: true, text: true }),
    ),
    alternatives: z.array(
      useCaseAlternatives.schema.pick({ key: true, text: true }),
    ),
    criteria: z.array(
      useCaseCriteria.schema
        .pick({
          key: true,
          givenText: true,
          whenText: true,
          thenText: true,
          text: true,
          method: true,
          alternativeKey: true,
        })
        .partial({ key: true, method: true }),
    ),
  })
  .partial();

export type UseCaseInput = Infer<typeof useCaseInputSchema>;
