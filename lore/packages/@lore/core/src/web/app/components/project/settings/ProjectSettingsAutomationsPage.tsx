import { Badge, cn, textLinkUnderlineClassName, TimeAgo } from "@alepha/ui";
import { DataTable, type RowActionEntry } from "@alepha/ui/table";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Bot, Play, Plus } from "lucide-react";
import { useState } from "react";

import type { AgentAutomationController } from "../../../../../api/controllers/AgentAutomationController.ts";
import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import type { AgentAutomationResource } from "../../../../../api/schemas/agentAutomationResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { type I18n } from "../../../services/I18n.ts";
import { useRank } from "../../shared/useRank.ts";
import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";
import AgentAutomationDialog from "./automations/AgentAutomationDialog.tsx";
import AgentAutomationEnabledCell from "./automations/AgentAutomationEnabledCell.tsx";

/**
 * The project's agent automations (#E172, #Q4231): one table and a small
 * form, on purpose. No canvas, no outline editor, no sidebar entry: the CLI
 * (`lore automation`) is the first surface, and this page shows what it set
 * up, switches a row on or off and runs one now.
 */
const ProjectSettingsAutomationsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<AgentAutomationController>();
  const jobsApi = useClient<HostJobController>();
  const [project] = useStore(currentProjectAtom);
  const [adding, setAdding] = useState(false);
  const manage = can("automation:manage");
  const key = ["project-automations", project?.id];

  const list = useQuery(
    {
      enabled: project !== undefined,
      key,
      handler: () =>
        api.listProjectAutomations({
          params: { projectId: project?.id as number },
        }),
    },
    [api, project?.id],
  );
  // The last run's status, read off the project's jobs.
  const jobs = useQuery(
    {
      enabled: project !== undefined,
      key: ["project-jobs", project?.id],
      handler: () =>
        jobsApi.listProjectJobs({
          params: { projectId: project?.id as number },
          query: { limit: 200 },
        }),
    },
    [jobsApi, project?.id],
  );
  const statusOf = new Map(
    (jobs.data?.items ?? []).map((job) => [job.id, job.status]),
  );

  const toggle = useAction<[name: string, enabled: boolean], void>(
    {
      handler: async (_ctx, name, enabled) => {
        if (!project) return;
        await api.updateProjectAutomation({
          params: { projectId: project.id, automation: name },
          body: { enabled },
        });
      },
      invalidates: [key],
    },
    [api, project?.id],
  );
  const run = useAction<[name: string], void>(
    {
      handler: async (_ctx, name) => {
        if (!project) return;
        await api.runProjectAutomation({
          params: { projectId: project.id, automation: name },
        });
      },
      invalidates: [key, ["project-jobs", project?.id]],
    },
    [api, project?.id],
  );
  const busy = toggle.loading || run.loading;
  const slug = project?.slug ?? String(project?.id ?? "");

  const onOf = (row: AgentAutomationResource): string => {
    if (row.trigger === "event") {
      return tr("automations.trigger.event", {
        args: [(row.eventKeys ?? []).join(", ")],
      });
    }
    if (row.trigger === "schedule") {
      return row.schedule === "daily"
        ? tr("automations.trigger.daily", {
            args: [String(row.dailyHour ?? 0)],
          })
        : row.schedule === "6h"
          ? tr("automations.trigger.6h")
          : tr("automations.trigger.hourly");
    }
    return tr("automations.trigger.manual");
  };

  const rowActions = (
    row: AgentAutomationResource,
  ): RowActionEntry<AgentAutomationResource>[] =>
    manage
      ? [
          {
            icon: Play,
            label: tr("automations.runNow"),
            disabled: () => busy,
            onClick: () => void run.run(row.name),
          },
        ]
      : [];

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col gap-4 md:-m-6">
      {list.data && (
        <DataTable<AgentAutomationResource>
          className="min-h-0 flex-1"
          flat
          data={list.data.items}
          rowKey={(row) => row.id}
          defaultSize={100}
          actions={[
            {
              icon: Plus,
              label: tr("automations.add"),
              primary: true,
              disabled: !manage,
              onClick: () => setAdding(true),
            },
          ]}
          emptyState={{
            icon: Bot,
            title: tr("automations.empty"),
            description: tr("automations.empty.description"),
          }}
          rowActions={rowActions}
          columns={{
            name: {
              label: tr("automations.table.name"),
              sortable: true,
              cell: (row) => (
                <span className="font-medium" data-testid="automation-name">
                  {row.name}
                </span>
              ),
            },
            promptKind: {
              label: tr("automations.table.prompt"),
              cell: (row) => (
                <Badge variant="secondary">
                  {tr(`automations.prompt.${row.promptKind}`)}
                </Badge>
              ),
            },
            trigger: {
              label: tr("automations.table.trigger"),
              cell: (row) => <span className="text-xs">{onOf(row)}</span>,
            },
            host: {
              label: tr("automations.table.where"),
              cell: (row) => (
                <span className="text-muted-foreground text-xs">
                  {row.promptKind === "chat"
                    ? `@${row.agent} · #${row.room}`
                    : [row.host, row.agent, row.model]
                        .filter(Boolean)
                        .join(" / ") || tr("automations.where.default")}
                </span>
              ),
            },
            lastRunAt: {
              label: tr("automations.table.lastRun"),
              sortable: true,
              cell: (row) => {
                const status = row.lastJobId
                  ? statusOf.get(row.lastJobId)
                  : undefined;
                if (!row.lastJobId || !row.lastRunAt) {
                  return (
                    <span className="text-muted-foreground text-xs">
                      {tr("automations.never")}
                    </span>
                  );
                }
                return (
                  <span className="flex items-center gap-2">
                    {status && <JobStatusBadge status={status} />}
                    <Link
                      href={`/${slug}/jobs/${row.lastJobId}`}
                      className={cn(textLinkUnderlineClassName, "text-xs")}
                    >
                      <TimeAgo value={row.lastRunAt} />
                    </Link>
                  </span>
                );
              },
            },
            nextRunAt: {
              label: tr("automations.table.next"),
              cell: (row) =>
                row.lastSkippedReason &&
                (!row.lastRunAt ||
                  (row.lastSkippedAt ?? "") > (row.lastRunAt ?? "")) ? (
                  <span
                    className="text-muted-foreground text-xs"
                    data-testid="automation-skipped"
                  >
                    {tr("automations.skipped", {
                      args: [row.lastSkippedReason],
                    })}
                  </span>
                ) : row.nextRunAt ? (
                  <TimeAgo
                    value={row.nextRunAt}
                    className="text-muted-foreground text-xs"
                  />
                ) : null,
            },
            enabled: {
              label: tr("automations.table.enabled"),
              cell: (row) => (
                <AgentAutomationEnabledCell
                  enabled={row.enabled}
                  disabled={!manage || busy}
                  label={tr("automations.table.enabled")}
                  onChange={(enabled) => void toggle.run(row.name, enabled)}
                />
              ),
            },
          }}
        />
      )}
      {project && (
        <AgentAutomationDialog
          open={adding}
          onOpenChange={setAdding}
          projectId={project.id}
          invalidates={key}
        />
      )}
    </div>
  );
};

export default ProjectSettingsAutomationsPage;
