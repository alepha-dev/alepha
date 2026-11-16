import { Badge } from "@alepha/ui";
import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import RunStateBadge from "./RunStateBadge.tsx";
import {
  ACTOR_ROLE_LABEL_KEYS,
  USE_CASE_PRIORITY_LABEL_KEYS,
} from "./useCaseLabels.ts";
import UseCaseStatusBadge from "./UseCaseStatusBadge.tsx";

export interface UseCaseAsideProps {
  useCase: UseCaseResource;
}

/**
 * A use case's identity card (#E153): reference and scenario version, name,
 * status and priority, its validation, actors with their role, the epics
 * covering it, starting data and automated test. A row with nothing to say
 * is omitted. Requirements and results by environment arrive later.
 */
const UseCaseAside = (props: UseCaseAsideProps) => {
  const { tr } = useI18n<I18n, "en">();
  const useCase = props.useCase;

  const rows: DetailAsideRow[] = [
    {
      label: tr("requirements.persona.aside.id"),
      value: (
        <span className="text-sm">
          <span className="font-mono">
            {formatReference("usecase", useCase.number)}
          </span>{" "}
          <span className="text-muted-foreground">
            ·{" "}
            {tr("requirements.usecase.aside.version", {
              args: [String(useCase.scenarioVersion)],
            })}
          </span>
        </span>
      ),
    },
    {
      label: tr("requirements.usecase.field.title"),
      value: (
        <span className="text-sm font-medium break-words">{useCase.title}</span>
      ),
    },
    {
      label: tr("requirements.usecase.field.status"),
      value: (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5">
            <UseCaseStatusBadge status={useCase.status} />
            <Badge variant="tint">
              {tr(USE_CASE_PRIORITY_LABEL_KEYS[useCase.priority])}
            </Badge>
          </div>
          {useCase.validationRequestedAt ? (
            <span
              className="text-muted-foreground text-xs"
              data-testid="validation-requested"
            >
              {tr("requirements.usecase.validation.requested")}
            </span>
          ) : null}
          {useCase.validationNote ? (
            <span className="text-muted-foreground text-xs">
              {useCase.validationNote}
            </span>
          ) : null}
        </div>
      ),
    },
    ...(useCase.actors.length
      ? [
          {
            label: tr("requirements.usecase.field.actors"),
            value: (
              <ul className="flex flex-col gap-1 text-sm">
                {useCase.actors.map((actor) => (
                  <li
                    key={actor.personaId}
                    className="flex justify-between gap-2"
                  >
                    <span>{actor.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {tr(ACTOR_ROLE_LABEL_KEYS[actor.role])}
                    </span>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    ...(useCase.coveredBy.length
      ? [
          {
            label: tr("requirements.usecase.aside.coveredBy"),
            value: (
              <ul className="flex flex-col gap-0.5 text-sm">
                {useCase.coveredBy.map((epic) => (
                  <li key={epic.id}>
                    {formatReference("epic", epic.number)} {epic.title}
                    {epic.progress ? (
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        ·{" "}
                        {tr("requirements.usecase.development", {
                          args: [
                            String(epic.progress.completed),
                            String(epic.progress.total),
                          ],
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    {
      label: tr("requirements.run.lastResult"),
      value: (
        <span className="flex flex-col gap-1">
          <RunStateBadge state={useCase.state} stale={useCase.stale} />
          {useCase.lastRun ? (
            <span className="text-muted-foreground text-xs">
              {useCase.lastRun.app
                ? `${useCase.lastRun.app}${useCase.lastRun.env ? `/${useCase.lastRun.env}` : ""}`
                : (useCase.lastRun.env ?? "local")}
            </span>
          ) : null}
        </span>
      ),
    },
    ...(useCase.startingData
      ? [
          {
            label: tr("requirements.usecase.field.startingData"),
            value: (
              <code className="font-mono text-xs break-all">
                {useCase.startingData}
              </code>
            ),
          },
        ]
      : []),
    ...(useCase.automatedTestPath
      ? [
          {
            label: tr("requirements.usecase.aside.automatedTest"),
            value: (
              <span className="text-xs">
                <code className="font-mono break-all">
                  {useCase.automatedTestPath}
                </code>
                {useCase.automatedTestTag
                  ? ` · ${useCase.automatedTestTag}`
                  : ""}
              </span>
            ),
          },
        ]
      : []),
  ];

  return <DetailAside rows={rows} />;
};

export default UseCaseAside;
