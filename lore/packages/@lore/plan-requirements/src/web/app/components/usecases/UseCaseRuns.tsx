import { Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RunController } from "../../../../api/controllers/RunController.ts";
import type { UseCaseRunResource } from "../../../../api/schemas/useCaseRunResourceSchema.ts";

const BY_KEYS = {
  agent: "requirements.run.by.agent",
  ci: "requirements.run.by.ci",
  person: "requirements.run.by.person",
} as const;

const RESULT_KEYS = {
  passed: "requirements.run.result.passed",
  failed: "requirements.run.result.failed",
  not_run: "requirements.run.result.not_run",
} as const;

export interface UseCaseRunsProps {
  projectId: number;
  number: number;
}

/**
 * A use case's runs, newest first (#E153): who, where, when, the scenario
 * version, each criterion's result and the evidence kept.
 */
const UseCaseRuns = (props: UseCaseRunsProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const runApi = useClient<RunController>();
  const runs = useQuery<UseCaseRunResource[]>(
    {
      key: ["use-case-runs", props.projectId, props.number],
      handler: async () =>
        await runApi.getUseCaseRuns({
          params: { projectId: props.projectId, number: props.number },
        }),
    },
    [runApi, props.projectId, props.number],
  );
  const rows = runs.data ?? [];
  if (runs.data && rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {tr("requirements.run.none")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="use-case-runs">
      {rows.map((run) => (
        <Card key={run.id}>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
              <span>{i18n.l(run.ranAt, { date: "lll" })}</span>
              <span>
                · {tr(BY_KEYS[run.by])}
                {run.client ? ` (${run.client})` : ""}
              </span>
              <span>
                ·{" "}
                {run.app
                  ? `${run.app}${run.env ? `/${run.env}` : ""}`
                  : (run.env ?? "local")}
              </span>
              <span>· v{run.scenarioVersion}</span>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {run.results.map((it) => (
                <li key={it.criterionKey}>
                  <span className="font-semibold">{it.criterionKey}</span>{" "}
                  <span
                    className={
                      it.result === "failed"
                        ? "text-danger-text"
                        : it.result === "passed"
                          ? "text-green-700 dark:text-green-400"
                          : "text-muted-foreground"
                    }
                  >
                    {tr(RESULT_KEYS[it.result])}
                  </span>
                  {it.note ? (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {it.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {run.note ? (
              <p className="text-muted-foreground text-xs">{run.note}</p>
            ) : null}
            {run.evidence.length ? (
              <ul className="flex flex-wrap gap-2 text-xs">
                {run.evidence.map((file) =>
                  file.removedAt ? (
                    <li key={file.fileId} className="text-muted-foreground">
                      {file.name} · {tr("requirements.run.evidence.removed")}
                    </li>
                  ) : (
                    <li key={file.fileId}>
                      <a
                        className="underline"
                        href={`/api/files/${file.fileId}`}
                      >
                        {file.name}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default UseCaseRuns;
