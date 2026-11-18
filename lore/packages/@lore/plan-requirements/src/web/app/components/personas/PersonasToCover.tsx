import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import WarningNotice from "../shared/WarningNotice.tsx";

export interface PersonasToCoverProps {
  projectSlug: string;
  /**
   * The personas with no passing use case.
   */
  personas: readonly PersonaResource[];
  /**
   * The use cases no one has run.
   */
  useCases: readonly UseCaseResource[];
  onDismiss: () => void;
}

/**
 * The Personas page's "To cover" band (#E153, #Q3772): one line that counts
 * what is left to cover, and, opened, every item of it, each a link to its
 * persona or use case. Folded at first: the counts say how much, the list
 * says what. Neither the fold nor the dismissal is remembered.
 */
const PersonasToCover = (props: PersonasToCoverProps) => {
  const { tr } = useI18n<I18n, "en">();
  // A route name built from this package's constants; see the router.
  const router = useRouter<any>();
  const [open, setOpen] = useState(false);
  const personas = props.personas.length;
  const useCases = props.useCases.length;

  const counts = [
    personas > 0
      ? tr(
          personas === 1
            ? "requirements.persona.toCover.personas.one"
            : "requirements.persona.toCover.personas",
          { args: [String(personas)] },
        )
      : undefined,
    useCases > 0
      ? tr(
          useCases === 1
            ? "requirements.persona.toCover.useCases.one"
            : "requirements.persona.toCover.useCases",
          { args: [String(useCases)] },
        )
      : undefined,
  ].filter(Boolean);

  return (
    <WarningNotice
      className="mb-4"
      data-testid="to-cover-banner"
      onDismiss={props.onDismiss}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-x-2 text-start"
        data-testid="to-cover-toggle"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-semibold">
          {tr("requirements.persona.toCover.title")}
        </span>
        <span className="text-muted-foreground">{counts.join(" · ")}</span>
      </button>
      {open ? (
        <ul
          className="mt-2 flex list-disc flex-col gap-1 ps-9"
          data-testid="to-cover-list"
        >
          {props.personas.map((persona) => (
            <li key={`persona-${persona.id}`}>
              <Link
                className="hover:underline"
                href={router.path("projectPersona", {
                  params: {
                    projectSlug: props.projectSlug,
                    personaNumber: String(persona.number),
                  },
                })}
              >
                {tr("requirements.persona.toCover.persona", {
                  args: [
                    formatReference("persona", persona.number),
                    persona.name,
                  ],
                })}
              </Link>
            </li>
          ))}
          {props.useCases.map((useCase) => (
            <li key={`usecase-${useCase.id}`}>
              <Link
                className="hover:underline"
                href={router.path("projectUseCase", {
                  params: {
                    projectSlug: props.projectSlug,
                    useCaseNumber: String(useCase.number),
                  },
                })}
              >
                {tr("requirements.persona.toCover.useCase", {
                  args: [
                    formatReference("usecase", useCase.number),
                    useCase.title,
                  ],
                })}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </WarningNotice>
  );
};

export default PersonasToCover;
