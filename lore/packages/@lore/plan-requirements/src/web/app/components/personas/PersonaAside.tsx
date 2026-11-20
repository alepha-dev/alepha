import { Badge } from "@alepha/ui";
import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import { currentProjectAtom, formatReference, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import AlephaRoleValue from "./AlephaRoleValue.tsx";
import PersonaAvatar from "./PersonaAvatar.tsx";
import { personaCoverage } from "./personaCoverage.ts";
import {
  PERSONA_KIND_ICONS,
  PERSONA_KIND_LABEL_KEYS,
  PERSONA_KIND_TONES,
} from "./personaKindLabels.ts";
import PersonaRunBar from "./PersonaRunBar.tsx";

export interface PersonaAsideProps {
  persona: PersonaResource;
  /**
   * Opens the page's Use cases tab: the coverage line becomes its link.
   */
  onOpenUseCases?: () => void;
}

/**
 * The persona page's identity card (#E153): the avatar, name and role on
 * top, then its reference, kind, Alepha role, demo account, environment,
 * coverage, areas and creation date. A row with nothing to say is omitted.
 */
const PersonaAside = (props: PersonaAsideProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const persona = props.persona;
  const KindIcon = PERSONA_KIND_ICONS[persona.kind];
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const projectId = project?.id ?? 0;
  // The project's use cases, under the key the lists read, so the coverage
  // row costs no request when a list was opened first.
  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );
  const coverage = useCases.data
    ? personaCoverage(persona, useCases.data)
    : undefined;

  const rows: DetailAsideRow[] = [
    {
      label: tr("requirements.persona.aside.id"),
      copy: formatReference("persona", persona.number),
    },
    {
      label: tr("requirements.persona.field.kind"),
      value: (
        <Badge variant="tint" tone={PERSONA_KIND_TONES[persona.kind]}>
          <KindIcon className="size-3" />
          {tr(PERSONA_KIND_LABEL_KEYS[persona.kind])}
        </Badge>
      ),
    },
    ...(persona.alephaRole
      ? [
          {
            label: tr("requirements.persona.field.alephaRole"),
            value: <AlephaRoleValue role={persona.alephaRole} />,
          },
        ]
      : []),
    ...(persona.demoAccount
      ? [
          {
            label: tr("requirements.persona.field.demoAccount"),
            copy: persona.demoAccount,
          },
        ]
      : []),
    ...(persona.demoSeed
      ? [
          {
            label: tr("requirements.persona.field.demoSeed"),
            copy: persona.demoSeed,
          },
        ]
      : []),
    ...(persona.environmentApp
      ? [
          {
            label: tr("requirements.persona.aside.environment"),
            value: `${persona.environmentApp}${persona.environmentEnv ? ` · ${persona.environmentEnv}` : ""}`,
          },
        ]
      : []),
    ...(coverage && coverage.useCases > 0
      ? [
          {
            label: tr("requirements.persona.aside.coverage"),
            value: (
              <div className="flex flex-col gap-1.5 pt-1">
                <PersonaRunBar coverage={coverage} />
                <span className="text-muted-foreground text-xs">
                  {/* Opens the Use cases tab, which lists them (#Q3966). */}
                  {props.onOpenUseCases ? (
                    <button
                      type="button"
                      className="hover:text-foreground underline-offset-2 hover:underline"
                      data-testid="persona-coverage-link"
                      onClick={props.onOpenUseCases}
                    >
                      {tr("requirements.persona.aside.passed", {
                        args: [
                          String(coverage.passed),
                          String(coverage.useCases),
                        ],
                      })}
                    </button>
                  ) : (
                    tr("requirements.persona.aside.passed", {
                      args: [
                        String(coverage.passed),
                        String(coverage.useCases),
                      ],
                    })
                  )}
                  {coverage.failed > 0
                    ? ` · ${tr("requirements.persona.card.failed", {
                        args: [String(coverage.failed)],
                      })}`
                    : ""}
                </span>
                {coverage.stale > 0 ? (
                  <span className="text-xs text-orange-600 dark:text-orange-400">
                    {tr(
                      coverage.stale === 1
                        ? "requirements.persona.aside.stale.one"
                        : "requirements.persona.aside.stale",
                      { args: [String(coverage.stale)] },
                    )}
                  </span>
                ) : null}
              </div>
            ),
          },
        ]
      : []),
    ...(persona.areas.length
      ? [
          {
            label: tr("requirements.persona.aside.areas"),
            value: persona.areas.join(", "),
          },
        ]
      : []),
    {
      label: tr("requirements.persona.aside.created"),
      value: i18n.l(persona.createdAt, { date: "ll" }),
    },
  ];

  // The identity sits above the card: the persona's own round,
  // tinted avatar, its name and role, rather than the aside's square
  // letter avatar and title above the card.
  return (
    <DetailAside
      avatar={false}
      header={
        <div className="flex items-center gap-3">
          <PersonaAvatar name={persona.name} className="size-12" />
          {/* Name and role wrap rather than truncate: the panel is the one
              place the whole role is read. */}
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold break-words">
              {persona.name}
            </div>
            {persona.role ? (
              <div className="text-muted-foreground text-xs break-words">
                {persona.role}
              </div>
            ) : null}
          </div>
        </div>
      }
      rows={rows}
    />
  );
};

export default PersonaAside;
