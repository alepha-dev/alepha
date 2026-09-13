import * as React from "react";

void React;

import { z } from "alepha";
import type { AdminJobController } from "alepha/api/jobs";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useQueryParams, useRouter, useRouterState } from "alepha/react/router";
import { History, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import { useToast } from "../core/useToast.tsx";
import { DetailLayout } from "../shell/DetailLayout.tsx";
import { useDetailTab } from "../shell/useDetailTab.tsx";
import { AdminJobDetailAside } from "./AdminJobDetailAside.tsx";
import { AdminJobDetailExecutions } from "./AdminJobDetailExecutions.tsx";
import { AdminJobExecutionSheet } from "./AdminJobExecutionSheet.tsx";

export interface AdminJobDetailProps {
  /**
   * Where "Back" goes when the job does not exist. Defaults to
   * `/admin/jobs`, the list `AdminRouter` mounts; an application rendering
   * the list somewhere else passes its own path.
   */
  backPath?: string;
}

const executionQuerySchema = z.object({
  execution: z.string().optional(),
});

/**
 * One job, on its own page: what it is in the aside, its executions in a
 * table that sorts, filters, pages and deletes, and one execution's logs,
 * error and payload in a drawer inside the page.
 *
 * The drawer is bound to `?execution=<id>` so a run can be linked. The job
 * comes from the route's `:jobName`; while leaving the page the router state
 * re-renders this component with the next route's params, so nothing is
 * fetched for an empty name.
 */
export const AdminJobDetail = (props: AdminJobDetailProps) => {
  const router = useRouter();
  const routerState = useRouterState();
  const jobName = String(
    (routerState.params as { jobName?: string }).jobName ?? "",
  );
  const client = useClient<AdminJobController>();
  const { tr } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useDetailTab<"executions">("executions");
  const [query, setQuery] = useQueryParams(executionQuerySchema, {
    format: "querystring",
  });
  // Bumped after a trigger, so the table reads the run it just made instead
  // of waiting for its next poll.
  const [tableKey, setTableKey] = useState(0);
  const backPath = props.backPath ?? "/admin/jobs";

  const jobs = useQuery(
    {
      enabled: jobName !== "",
      handler: () => client.listJobs(),
    },
    [client, jobName],
  );
  const job = jobs.data?.find((j) => j.name === jobName);

  const trigger = useAction(
    {
      handler: async () => {
        await client.triggerJob({ params: { name: jobName }, body: {} });
        toast.success(
          tr("admin.jobs.triggered", {
            default: `Triggered ${jobName}`,
            args: [jobName],
          }),
        );
        setTableKey((k) => k + 1);
        await jobs.refetch();
      },
    },
    [client, jobName, toast, tr],
  );

  // A cron only: a pushed job needs a payload this button cannot send.
  const canTrigger = job?.type === "cron" && client.triggerJob.can();

  return (
    <>
      <DetailLayout
        loading={jobs.loading && !jobs.data}
        notFound={
          job
            ? undefined
            : {
                message: String(
                  tr("admin.jobs.notFound", { default: "Job not found." }),
                ),
                backLabel: String(
                  tr("admin.jobs.back", { default: "Back to jobs" }),
                ),
                onBack: () => void router.push(backPath),
              }
        }
        aside={job ? <AdminJobDetailAside job={job} /> : null}
        tabs={[
          {
            value: "executions",
            icon: History,
            label: tr("admin.jobs.tabExecutions", { default: "Executions" }),
          },
        ]}
        tab={tab}
        onTabChange={(value) => setTab(value as "executions")}
        actions={
          canTrigger ? (
            <Button
              variant="outline"
              size="lg"
              loading={trigger.loading}
              onClick={() => void trigger.run()}
            >
              <Play className="size-4" />
              {tr("admin.jobs.trigger", { default: "Trigger now" })}
            </Button>
          ) : undefined
        }
      >
        {job && (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <AdminJobDetailExecutions
              key={tableKey}
              jobName={job.name}
              onOpen={(execution) => setQuery({ execution: execution.id })}
            />
          </div>
        )}
      </DetailLayout>

      <AdminJobExecutionSheet
        executionId={query.execution || undefined}
        onClose={() => setQuery({ execution: undefined })}
      />
    </>
  );
};

export default AdminJobDetail;
