import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RunController } from "../../../../api/controllers/RunController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import type { UseCaseRunResource } from "../../../../api/schemas/useCaseRunResourceSchema.ts";
import UseCaseRunCard from "./UseCaseRunCard.tsx";

export interface UseCaseRunsProps {
  projectId: number;
  number: number;
  /**
   * The use case's criteria, which title each result row.
   */
  criteria: UseCaseResource["criteria"];
}

/**
 * A use case's runs, newest first (#E153), each a `UseCaseRunCard` (#Q3975):
 * its score and verdict, then one row per criterion with its evidence and
 * files (#Q3977).
 */
const UseCaseRuns = (props: UseCaseRunsProps) => {
  const { tr } = useI18n<I18n, "en">();
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
      <p className="text-muted-foreground text-sm italic">
        {tr("requirements.run.none")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="use-case-runs">
      {rows.map((run) => (
        <UseCaseRunCard key={run.id} run={run} criteria={props.criteria} />
      ))}
    </div>
  );
};

export default UseCaseRuns;
