import { Button, useDialog } from "@alepha/ui";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { RefreshCw } from "lucide-react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { AutomationOutline } from "../../../../../api/schemas/AutomationOutline.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { usePageCrumb } from "../../shared/usePageCrumb.ts";
import AutomationPage from "./AutomationPage.tsx";
import AutomationRunEvidence from "./AutomationRunEvidence.tsx";
import AutomationOutlineView from "./outline/AutomationOutlineView.tsx";
import { useAutomationOutlineNames } from "./outline/useAutomationOutlineNames.ts";

export interface AutomationRunPageProps {
  runId: string;
}
const AutomationRunPage = (props: AutomationRunPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const router = useRouter();
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
  const names = useAutomationOutlineNames(run?.snapshot?.rule ?? undefined);
  const dialog = useDialog();
  // A graph the outline cannot show gets a notice with Delete (#Q3847): the
  // automation is read then, for its revision and whether the viewer may.
  const refused =
    !!run?.snapshot?.rule &&
    !new AutomationOutline().read(run.snapshot.rule).outline;
  const automation = useQuery(
    {
      key: ["automation", project?.id, run?.automationId],
      enabled: !!project && refused,
      handler: ({ signal }) =>
        api.getAutomation(
          { params: { projectId: project!.id, id: run!.automationId } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [project?.id, run?.automationId, refused],
  );
  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        const rule = automation.data;
        if (!rule || !project) return false;
        if (
          !(await dialog.confirm({
            title: tr("automation.delete.title"),
            description: tr("automation.delete.description", {
              args: [rule.title],
            }),
            confirmLabel: tr("automation.delete"),
            destructive: true,
          }))
        )
          return false;
        await api.deleteAutomation({
          params: { projectId: project.id, id: rule.id },
          body: { expectedRevision: rule.revision },
        });
        queries.invalidate(["automations", project.id]);
        await router.push("projectAutomations", {
          params: { projectSlug: project.slug },
        });
        return true;
      },
    },
    [api, automation.data, project, queries, dialog, tr],
  );
  // The trail ends with this run (#Q3408), named as the page's title is.
  usePageCrumb(
    "projectAutomationRun",
    run ? tr(`automation.run.${run.status}`) : undefined,
  );
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
          {snapshot.rule && (
            // The automation as it was at the run's revision (#Q3804),
            // its one block painted with what each row did (#Q3807).
            <AutomationOutlineView
              graph={snapshot.rule}
              names={names}
              outcomes={run!.nodes}
              onDelete={
                automation.data?.canDelete ? () => void remove.run() : undefined
              }
              busy={remove.loading}
            />
          )}
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
