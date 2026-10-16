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
  const items = read.data?.items ?? [];
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-medium">{tr("automation.history.title")}</h2>
        <p className="text-muted-foreground text-sm">
          {tr("automation.history.retention")}
        </p>
      </div>
      {read.data && !items.length && !offset ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {tr("automation.run.none")}
        </div>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-lg border">
          {items.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="hover:bg-hover flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left text-sm"
                onClick={() =>
                  router.push("projectAutomationRun", {
                    params: { projectSlug: project!.slug, runId: run.id },
                  })
                }
              >
                <span className="font-medium">
                  {tr(`automation.run.${run.status}`)}
                </span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                  {run.reason || run.redactionReason}
                </span>
                <TimeAgo
                  value={run.triggeredAt}
                  className="text-muted-foreground text-xs"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(offset > 0 || read.data?.hasMore) && (
        <div className="flex gap-2">
          <Button
            variant="minimal"
            size="sm"
            disabled={read.loading || !offset}
            onClick={() => setOffset((value) => Math.max(0, value - 20))}
          >
            {tr("automation.previous")}
          </Button>
          <Button
            variant="minimal"
            size="sm"
            disabled={read.loading || !read.data?.hasMore}
            onClick={() => setOffset((value) => value + 20)}
          >
            {tr("automation.next")}
          </Button>
        </div>
      )}
    </section>
  );
};
export default AutomationRunList;
