import { Button } from "@alepha/ui";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationRunEvidence from "./AutomationRunEvidence.tsx";

export interface AutomationRunPageProps {
  runId: string;
}
const AutomationRunPage = (props: AutomationRunPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const router = useRouter<AutomationRouter>();
  const { tr, l } = useI18n<I18n, "en">();
  const read = useQuery(
    {
      key: ["automation-run", project?.id, props.runId],
      enabled: !!project,
      handler: ({ signal }) =>
        api.getAutomationRun(
          { params: { projectId: project!.id, id: props.runId } },
          { request: { signal } },
        ),
    },
    [project?.id, props.runId],
  );
  const run = read.data;
  const snapshot = run?.snapshot;
  return (
    <div className="flex max-w-3xl flex-col gap-5 py-5">
      <h1 className="text-xl font-semibold">
        {tr("automation.history.detail")}
      </h1>
      <p className="text-muted-foreground text-sm">
        {tr("automation.history.retention")}
      </p>
      <p className="text-muted-foreground text-sm">
        {tr("automation.history.replay")}
      </p>
      <Button
        variant="outlined"
        disabled={read.loading}
        onClick={() =>
          queries.invalidate(["automation-run", project?.id, props.runId])
        }
      >
        {tr("automation.history.refresh")}
      </Button>
      {read.error && (
        <p role="alert">
          {read.error instanceof Error
            ? read.error.message
            : tr("automation.redacted")}
        </p>
      )}
      {run && (
        <>
          <Button
            variant="link"
            onClick={() =>
              router.push("projectAutomationDetail", {
                params: {
                  projectSlug: project!.slug,
                  automationId: run.automationId,
                },
              })
            }
          >
            {tr("automation.history.rule")}
          </Button>
          <p>
            {tr(`automation.run.${run.status}`)}:{" "}
            {l(run.triggeredAt, { date: "lll" })}
          </p>
          <p>{run.reason || run.redactionReason}</p>
          <p className="text-muted-foreground text-sm">
            {tr("automation.editor.revision", {
              args: [String(run.ruleRevision)],
            })}
          </p>
        </>
      )}
      {snapshot && (
        <>
          <p>
            {tr("automation.test.at", {
              args: [
                l(snapshot.evaluatedAt || run!.triggeredAt, { date: "lll" }),
              ],
            })}
          </p>
          <AutomationRunEvidence run={run!} />
        </>
      )}
    </div>
  );
};
export default AutomationRunPage;
