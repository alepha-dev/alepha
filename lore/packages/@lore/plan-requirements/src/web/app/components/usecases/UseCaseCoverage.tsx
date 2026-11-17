import { Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";

export interface UseCaseCoverageProps {
  projectId: number;
  useCase: UseCaseResource;
}

interface CoverageQuest {
  shortId: number;
  title: string;
  epicNumber: number;
  acceptedAt?: string;
  completedAt?: string;
}

/**
 * Development coverage (#E153): the quests of the epics covering the use
 * case, and whether each is done. A failed criterion opens an error only
 * once every one of them is.
 */
const UseCaseCoverage = (props: UseCaseCoverageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const useCaseApi = useClient<UseCaseController>();
  const coverage = useQuery<CoverageQuest[]>(
    {
      key: ["use-case-coverage", props.projectId, props.useCase.number],
      handler: async () =>
        await useCaseApi.getUseCaseCoverage({
          params: { projectId: props.projectId, number: props.useCase.number },
        }),
    },
    [useCaseApi, props.projectId, props.useCase.number],
  );
  const rows = coverage.data ?? [];
  const done = rows.length > 0 && rows.every((it) => it.completedAt);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {tr("requirements.usecase.coverage")}
          </h2>
          {done ? (
            <span className="text-success-text text-xs font-semibold">
              {tr("requirements.usecase.coverage.done")}
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {tr("requirements.usecase.coverage.help")}
        </p>
        {props.useCase.coveredBy.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            {tr("requirements.usecase.coverage.none")}
          </p>
        ) : (
          <ul
            className="flex flex-col gap-1 text-sm"
            data-testid="coverage-quests"
          >
            {rows.map((quest) => (
              <li key={quest.shortId} className="flex justify-between gap-2">
                <span>
                  <ReferenceLink kind="quest" number={quest.shortId}>
                    {quest.title}
                  </ReferenceLink>{" "}
                  <span className="text-xs">
                    <ReferenceLink kind="epic" number={quest.epicNumber} />
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr(
                    quest.completedAt
                      ? "requirements.usecase.quest.done"
                      : quest.acceptedAt
                        ? "requirements.usecase.quest.inProgress"
                        : "requirements.usecase.quest.open",
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default UseCaseCoverage;
