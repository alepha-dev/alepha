import { Button, TimeAgo } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AutomationRunListProps {
  automationId: string;
}
const AutomationRunList = (props: AutomationRunListProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const router = useRouter<AutomationRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [offset, setOffset] = useState(0);
  const read = useQuery(
    {
      key: ["automation-runs", project?.id, props.automationId, offset],
      enabled: !!project,
      handler: ({ signal }) =>
        api.listAutomationRuns(
          {
            params: { projectId: project!.id, id: props.automationId },
            query: { offset, limit: 20 },
          },
          { request: { signal } },
        ),
    },
    [project?.id, props.automationId, offset],
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{tr("automation.history.title")}</h2>
      <p className="text-muted-foreground text-sm">
        {tr("automation.history.retention")}
      </p>
      {read.data?.items.map((run) => (
        <div
          key={run.id}
          className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2"
        >
          <Button
            variant="link"
            onClick={() =>
              router.push("projectAutomationRun", {
                params: { projectSlug: project!.slug, runId: run.id },
              })
            }
          >
            {tr(`automation.run.${run.status}`)}:{" "}
            <TimeAgo value={run.triggeredAt} />
          </Button>
          <span className="text-muted-foreground text-xs">
            {run.reason || run.redactionReason}
          </span>
        </div>
      ))}
      {read.data && !read.data.items.length && (
        <p className="text-muted-foreground">{tr("automation.run.none")}</p>
      )}
      <div className="flex gap-2">
        <Button
          variant="minimal"
          disabled={read.loading || !offset}
          onClick={() => setOffset((value) => Math.max(0, value - 20))}
        >
          {tr("automation.previous")}
        </Button>
        <Button
          variant="minimal"
          disabled={read.loading || !read.data?.hasMore}
          onClick={() => setOffset((value) => value + 20)}
        >
          {tr("automation.next")}
        </Button>
      </div>
    </section>
  );
};
export default AutomationRunList;
