import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

/**
 * What a persona card reads about the use cases a persona acts in: how many,
 * the epics that cover them and the requirements their criteria trace to,
 * then how their last runs went. Counted from the project's use case list,
 * which the Personas page already holds, so the cards cost no request.
 */
export interface PersonaCoverage {
  useCases: number;
  epics: number;
  requirements: number;
  passed: number;
  failed: number;
  /**
   * Use cases whose last run predates a change that touches them.
   */
  stale: number;
  /**
   * The newest run of any of them, absent while none has run.
   */
  lastRanAt?: string;
}

export const personaCoverage = (
  persona: Pick<PersonaResource, "id">,
  useCases: readonly UseCaseResource[],
): PersonaCoverage => {
  const mine = useCases.filter((useCase) =>
    useCase.actors.some((actor) => actor.personaId === persona.id),
  );
  const epics = new Set(
    mine.flatMap((useCase) => useCase.coveredBy.map((epic) => epic.id)),
  );
  const requirements = new Set(
    mine.flatMap((useCase) =>
      useCase.criteria.flatMap((criterion) =>
        criterion.requirementNumber === undefined
          ? []
          : [criterion.requirementNumber],
      ),
    ),
  );
  const ranAt = mine
    .flatMap((useCase) => (useCase.lastRun ? [useCase.lastRun.ranAt] : []))
    .sort();
  return {
    useCases: mine.length,
    epics: epics.size,
    requirements: requirements.size,
    passed: mine.filter((useCase) => useCase.state === "passed").length,
    failed: mine.filter((useCase) => useCase.state === "failed").length,
    stale: mine.filter((useCase) => useCase.stale).length,
    lastRanAt: ranAt.at(-1),
  };
};
