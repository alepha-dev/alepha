import { Badge, Button, TimeAgo, useDialog } from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { z } from "alepha";
import {
  QueryCache,
  useAction,
  useClient,
  useInject,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Braces,
  CircleDot,
  Pause,
  Play,
  Plus,
  Replace,
  Trash2,
  Workflow,
} from "lucide-react";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { CoreRouter } from "../../../CoreRouter.ts";
import { loreDocsUrl } from "../../../services/docsUrl.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";
import { OutboundLink } from "../../shared/OutboundLink.tsx";
import { useAutomationLabels } from "./useAutomationLabels.ts";

/**
 * The project's automations, on the same table as Releases and Apps: a
 * primary New automation, a row that opens the rule, and the row menu for
 * enabling, disabling and deleting.
 */
const AutomationOverviewPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AutomationRouter & CoreRouter>();
  const api = useClient<AutomationController>();
  const cache = useInject(QueryCache);
  const queries = useQueryClient();
  const dialog = useDialog();
  const labels = useAutomationLabels();
  const [refresh, setRefresh] = useState(0);
  const outcomeLabels = {
    queued: tr("automation.run.queued"),
    running: tr("automation.run.running"),
    succeeded: tr("automation.run.succeeded"),
    skipped: tr("automation.run.skipped"),
    refused: tr("automation.run.refused"),
    partial: tr("automation.run.partial"),
    failed: tr("automation.run.failed"),
    unknown: tr("automation.run.unknown"),
  };
  // The refreshed server row owns the state shown, so both actions refresh
  // whether the write landed or was refused (a revision conflict included).
  const toggle = useAction<
    [row: AutomationResource, enabled: boolean],
    boolean
  >(
    {
      handler: async (_context, row, enabled) => {
        if (!project) return false;
        try {
          await api.setAutomationEnabled({
            params: { projectId: project.id, id: row.id },
            body: { expectedRevision: row.revision, enabled },
          });
        } finally {
          queries.invalidate(["automations", project.id]);
          setRefresh((value) => value + 1);
        }
        return true;
      },
    },
    [api, project?.id, queries],
  );
  const remove = useAction<[row: AutomationResource], boolean>(
    {
      handler: async (_context, row) => {
        if (!project) return false;
        if (
          !(await dialog.confirm({
            title: tr("automation.delete.title"),
            description: tr("automation.delete.description", {
              args: [row.title],
            }),
            confirmLabel: tr("automation.delete"),
            destructive: true,
          }))
        )
          return false;
        try {
          await api.deleteAutomation({
            params: { projectId: project.id, id: row.id },
            body: { expectedRevision: row.revision },
          });
        } finally {
          queries.invalidate(["automations", project.id]);
          setRefresh((value) => value + 1);
        }
        return true;
      },
    },
    [api, project?.id, queries, dialog, tr],
  );
  const busy = toggle.loading || remove.loading;
  const fields = {
    search: { preset: "search" },
    state: {
      schema: z.enum(["disabled", "active", "paused", "broken"]),
      label: tr("automation.column.state"),
      icon: CircleDot,
      items: Object.entries(labels.states).map(([value, label]) => ({
        value,
        label,
      })),
      control: { clearLabel: tr("automation.filter.allStates") },
    },
  } satisfies DataTableFilterFields;
  if (!project) return null;
  const canCreate = canInProject(project, "automation:write");
  const gallery = () =>
    router.push("projectAutomationGallery", {
      params: { projectSlug: project.slug },
    });
  const open = (row: AutomationResource) =>
    router.push("projectAutomationDetail", {
      params: { projectSlug: project.slug, automationId: row.id },
    });
  return (
    <div
      className="flex min-h-0 flex-1 flex-col p-2"
      data-testid="automation-list"
    >
      <DataTable<AutomationResource, typeof fields>
        key={project.id}
        className="min-h-0 flex-1"
        persistenceKey={`lore.automations.${project.id}`}
        refreshSignal={refresh}
        defaultSize={20}
        pageSizes={[10, 20, 50]}
        rowKey={(row) => row.id}
        filters={{ fields }}
        onRowClick={(row) => void open(row)}
        fetch={async ({ page, size, filters, signal }) => {
          const query = {
            offset: page * size,
            limit: size,
            ...(filters?.search ? { search: filters.search } : {}),
            ...(filters?.state ? { state: filters.state } : {}),
          };
          const result = await cache.dedupe(
            ["automations", project.id, query],
            (requestSignal) =>
              api.listAutomations(
                { params: { projectId: project.id }, query },
                { request: { signal: requestSignal } },
              ),
            { signal },
          );
          return {
            content: result.items,
            page: {
              number: page,
              size,
              offset: page * size,
              numberOfElements: result.items.length,
              isEmpty: !result.items.length,
              isFirst: page === 0,
              isLast: !result.hasMore,
            },
          };
        }}
        actions={[
          {
            icon: Braces,
            label: tr("automation.variables.title"),
            onClick: () =>
              router.push("projectAutomationVariables", {
                params: { projectSlug: project.slug },
              }),
            disabled: busy,
          },
          {
            icon: Replace,
            label: tr("automation.adoption.title"),
            onClick: () =>
              router.push("projectAutomationAdoption", {
                params: { projectSlug: project.slug },
              }),
            disabled: busy,
          },
          ...(canCreate
            ? [
                {
                  icon: Plus,
                  label: tr("automation.new"),
                  primary: true,
                  onClick: gallery,
                  disabled: busy,
                },
              ]
            : []),
        ]}
        rowActions={(row) => [
          ...(row.enabled && row.canDisable
            ? [
                {
                  icon: Pause,
                  label: tr("automation.disable"),
                  disabled: () => busy,
                  onClick: (item: AutomationResource) =>
                    void toggle.run(item, false),
                },
              ]
            : []),
          ...(!row.enabled && row.canEnable
            ? [
                {
                  icon: Play,
                  label: tr("automation.enable"),
                  disabled: () => busy,
                  onClick: (item: AutomationResource) =>
                    void toggle.run(item, true),
                },
              ]
            : []),
          ...(row.canDelete
            ? [
                {
                  icon: Trash2,
                  label: tr("automation.delete"),
                  destructive: true,
                  disabled: () => busy,
                  onClick: (item: AutomationResource) => void remove.run(item),
                },
              ]
            : []),
        ]}
        emptyState={{
          icon: Workflow,
          title: tr("automation.list.empty"),
          description: tr("automation.list.emptyDescription"),
          action: (
            <div className="flex flex-col items-center gap-3">
              {canCreate && (
                <Button disabled={busy} onClick={gallery}>
                  <Plus className="size-4" />
                  {tr("automation.new")}
                </Button>
              )}
              <OutboundLink
                href={loreDocsUrl("guides-automations")}
                className="text-muted-foreground text-sm underline underline-offset-4"
              >
                {tr("automation.guide")}
              </OutboundLink>
            </div>
          ),
        }}
        noMatchState={{
          title: tr("automation.list.noMatch"),
          description: tr("automation.list.noMatchDescription"),
        }}
        columns={{
          title: {
            label: tr("automation.column.name"),
            className: "w-full min-w-48",
            cell: (row) => (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{row.title}</span>
                {(row.reason || row.redactionReason) && (
                  <span className="text-muted-foreground text-xs">
                    {row.reason || row.redactionReason}
                  </span>
                )}
              </div>
            ),
          },
          trigger: {
            label: tr("automation.column.trigger"),
            className: "whitespace-nowrap",
            cell: (row) => labels.trigger(row.rule),
          },
          state: {
            label: tr("automation.column.state"),
            cell: (row) => (
              <div className="flex flex-col items-start gap-1">
                <Badge variant="tint" tone={labels.tones[row.displayState]}>
                  {labels.states[row.displayState]}
                </Badge>
                {row.requiresApproval && (
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {tr("automation.reviewRequired")}
                  </span>
                )}
              </div>
            ),
          },
          lastRun: {
            label: tr("automation.column.lastRun"),
            className: "whitespace-nowrap",
            cell: (row) =>
              row.lastRun ? (
                <div className="flex flex-col text-xs">
                  <span>{outcomeLabels[row.lastRun.status]}</span>
                  <TimeAgo
                    value={row.lastRun.at}
                    className="text-muted-foreground"
                  />
                  {row.lastRun.capped && (
                    <span>{tr("automation.run.capped")}</span>
                  )}
                  {row.lastRun.noData && (
                    <span>{tr("automation.run.noData")}</span>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("automation.run.none")}
                </span>
              ),
          },
          author: {
            label: tr("automation.column.author"),
            className: "whitespace-nowrap",
            cell: (row) => (
              <span title={row.authorUserId}>
                {row.authorName || row.authorUserId.slice(0, 8)}
              </span>
            ),
          },
        }}
      />
    </div>
  );
};

export default AutomationOverviewPage;
