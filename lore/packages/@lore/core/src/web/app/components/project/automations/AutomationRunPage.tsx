import { Button } from "@alepha/ui";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { RefreshCw } from "lucide-react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationPage from "./AutomationPage.tsx";
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
    <AutomationPage
      title={
        run
          ? tr(`automation.run.${run.status}`)
          : tr("automation.history.detail")
      }
      description={
        run
          ? tr("automation.history.triggered", {
              args: [l(run.triggeredAt, { date: "lll" })],
            })
          : undefined
      }
      actions={
        <>
          {run && (
            <Button
              variant="outlined"
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
          )}
          <Button
            variant="outlined"
            disabled={read.loading}
            onClick={() =>
              queries.invalidate(["automation-run", project?.id, props.runId])
            }
          >
            <RefreshCw className="size-4" />
            {tr("automation.history.refresh")}
          </Button>
        </>
      }
    >
      {read.error && (
        <p role="alert" className="text-danger-text">
          {read.error.message}
        </p>
      )}
      {run && (run.reason || run.redactionReason) && (
        <p className="text-sm">{run.reason || run.redactionReason}</p>
      )}
      {snapshot && (
        <>
          <p className="text-muted-foreground text-xs">
            {tr("automation.test.at", {
              args: [
                l(snapshot.evaluatedAt || run!.triggeredAt, { date: "lll" }),
              ],
            })}
          </p>
          <AutomationRunEvidence run={run!} />
        </>
      )}
      <p className="text-muted-foreground text-xs">
        {tr("automation.history.retention")} {tr("automation.history.replay")}
      </p>
    </AutomationPage>
  );
};
export default AutomationRunPage;
