import { useProjectAiContext } from "@lore/core/web";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

export interface UseCaseAiContextPublisherProps {
  useCase: UseCaseResource;
}

/**
 * Tells an assistant turn sent from a use case's page which use case it is
 * looking at (#Q3972): its reference, title, actors and their persona,
 * steps, criteria with the requirement each verifies, covering epics and
 * last run. "Review this use case" then needs no number typed. Renders
 * nothing.
 */
const UseCaseAiContextPublisher = (props: UseCaseAiContextPublisherProps) => {
  const useCase = props.useCase;
  const actorName = new Map(
    useCase.actors.map((it) => [it.personaId, it.name]),
  );
  useProjectAiContext("useCase", {
    kind: "useCase",
    reference: `#U${useCase.number}`,
    number: useCase.number,
    title: useCase.title,
    status: useCase.status,
    priority: useCase.priority,
    preconditions: useCase.preconditions || undefined,
    actors: useCase.actors.map((it) => ({
      persona: `#A${it.number}`,
      name: it.name,
      role: it.role,
    })),
    steps: useCase.steps.map((it) => ({
      position: it.position,
      actor:
        it.actorPersonaId === undefined
          ? "System"
          : actorName.get(it.actorPersonaId),
      text: it.text,
    })),
    alternatives: useCase.alternatives.map((it) => ({
      key: it.key,
      text: it.text,
    })),
    criteria: useCase.criteria.map((it) => ({
      key: it.key,
      text:
        it.text ??
        [it.givenText, it.whenText, it.thenText].filter(Boolean).join(" / "),
      ...(it.requirementNumber
        ? { requirement: `#S${it.requirementNumber}` }
        : {}),
    })),
    epics: useCase.coveredBy.map((it) => ({
      reference: `#E${it.number}`,
      title: it.title,
      status: it.status,
      progress: it.progress,
    })),
    state: useCase.state,
    stale: useCase.stale,
    lastRun: useCase.lastRun
      ? {
          id: useCase.lastRun.id,
          ranAt: useCase.lastRun.ranAt,
          results: useCase.lastRun.results,
        }
      : undefined,
  });
  return null;
};

export default UseCaseAiContextPublisher;
