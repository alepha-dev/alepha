import { Button, Badge, TimeAgo, useDialog } from "@alepha/ui";
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
import { Library, Settings, Braces } from "lucide-react";
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

const AutomationOverviewPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AutomationRouter & CoreRouter>();
  const api = useClient<AutomationController>();
  const cache = useInject(QueryCache);
  const queries = useQueryClient();
  const dialog = useDialog();
  const [refresh, setRefresh] = useState(0);
  const stateLabels = {
    disabled: tr("automation.state.disabled"),
    active: tr("automation.state.active"),
    paused: tr("automation.state.paused"),
    broken: tr("automation.state.broken"),
  };
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
  const events = {
    "feedback.created": tr("automation.event.feedbackCreated"),
    "release.published": tr("automation.event.releasePublished"),
    "epic.completed": tr("automation.event.epicCompleted"),
    "deploy.failed": tr("automation.event.deployFailed"),
    "deploy.succeeded": tr("automation.event.deploySucceeded"),
    "quest.completed": tr("automation.event.questCompleted"),
  };
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
    search: {
      schema: z.string(),
      label: tr("automation.search.label"),
      placeholder: tr("automation.search.placeholder"),
      mode: "locked",
    },
    state: {
      schema: z.enum(["disabled", "active", "paused", "broken"]),
      label: tr("automation.column.state"),
      items: Object.entries(stateLabels).map(([value, label]) => ({
        value,
        label,
      })),
    },
  } satisfies DataTableFilterFields;
  if (!project) return null;
  const canCreate = canInProject(project, "automation:write");
  const gallery = () =>
    router.push("projectAutomationGallery", {
      params: { projectSlug: project.slug },
    });
  const settings = () =>
    router.push("projectSettingsCapabilities", {
      params: { projectSlug: project.slug },
    });
  return (
    <div
      className="flex min-h-0 flex-1 flex-col p-2"
      data-testid="automation-list"
    >
      <div className="flex justify-end px-3 pb-2">
        <OutboundLink
          href={loreDocsUrl("guides-automations")}
          className="text-primary text-xs hover:underline"
        >
          {tr("automation.guide")}
        </OutboundLink>
      </div>
      <DataTable<AutomationResource, typeof fields>
        key={project.id}
        className="min-h-0 flex-1"
        persistenceKey={`lore.automations.${project.id}`}
        refreshSignal={refresh}
        defaultSize={20}
        pageSizes={[10, 20, 50]}
        rowKey={(row) => row.id}
        filters={{ fields }}
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
            icon: Settings,
            label: tr("automation.adoption.title"),
            onClick: () =>
              router.push("projectAutomationAdoption", {
                params: { projectSlug: project.slug },
              }),
            disabled: busy,
          },
          {
            icon: Braces,
            label: tr("automation.variables.title"),
            onClick: () =>
              router.push("projectAutomationVariables", {
                params: { projectSlug: project.slug },
              }),
            disabled: busy,
          },
          ...(canCreate
            ? [
                {
                  icon: Library,
                  label: tr("automation.gallery.browse"),
                  primary: true,
                  onClick: gallery,
                  disabled: busy,
                },
              ]
            : []),
          ...(canInProject(project, "capability:manage")
            ? [
                {
                  icon: Settings,
                  label: tr("automation.settings"),
                  onClick: settings,
                  disabled: busy,
                },
              ]
            : []),
        ]}
        emptyState={{
          title: tr("automation.list.empty"),
          description: tr("automation.list.emptyDescription"),
          ...(canCreate
            ? {
                action: (
                  <Button disabled={busy} onClick={gallery}>
                    {tr("automation.gallery.browse")}
                  </Button>
                ),
              }
            : {}),
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
              <Button
                variant="link"
                disabled={busy}
                onClick={() =>
                  router.push("projectAutomationDetail", {
                    params: { projectSlug: project.slug, automationId: row.id },
                  })
                }
              >
                {row.title}
              </Button>
            ),
          },
          author: {
            label: tr("automation.column.author"),
            cell: (row) => (
              <span title={row.authorUserId}>
                {row.authorName || row.authorUserId.slice(0, 8)}
              </span>
            ),
          },
          trigger: {
            label: tr("automation.column.trigger"),
            cell: (row) =>
              row.rule
                ? row.rule.trigger.kind === "event"
                  ? events[row.rule.trigger.event]
                  : `${row.rule.trigger.cron} UTC`
                : tr("automation.redacted"),
          },
          state: {
            label: tr("automation.column.state"),
            cell: (row) => (
              <div className="flex max-w-sm flex-col gap-1">
                <Badge variant="outline">{stateLabels[row.displayState]}</Badge>
                {row.displayState === "disabled" && row.health !== "active" && (
                  <span className="text-muted-foreground text-xs">
                    {stateLabels[row.health]}
                  </span>
                )}
                {(row.reason || row.redactionReason) && (
                  <p className="text-muted-foreground text-xs">
                    {row.reason || row.redactionReason}
                  </p>
                )}
                {row.requiresApproval && (
                  <span className="text-muted-foreground text-xs">
                    {tr("automation.reviewRequired")}
                  </span>
                )}
                {row.health === "broken" &&
                  canInProject(project, "capability:manage") && (
                    <Button
                      variant="link"
                      size="sm"
                      disabled={busy}
                      onClick={settings}
                    >
                      {tr("automation.settings")}
                    </Button>
                  )}
              </div>
            ),
          },
          lastRun: {
            label: tr("automation.column.lastRun"),
            cell: (row) =>
              row.lastRun ? (
                <div className="flex flex-col gap-1 text-xs">
                  <span>{outcomeLabels[row.lastRun.status]}</span>
                  <TimeAgo value={row.lastRun.at} />
                  {row.lastRun.capped && (
                    <span>{tr("automation.run.capped")}</span>
                  )}
                  {row.lastRun.noData && (
                    <span>{tr("automation.run.noData")}</span>
                  )}
                </div>
              ) : (
                tr("automation.run.none")
              ),
          },
          controls: {
            label: tr("automation.column.controls"),
            cell: (row) => (
              <div className="flex gap-2">
                {(row.enabled ? row.canDisable : row.canEnable) && (
                  <Button
                    variant="outlined"
                    size="sm"
                    disabled={busy}
                    onClick={() => void toggle.run(row, !row.enabled)}
                  >
                    {row.enabled
                      ? tr("automation.disable")
                      : tr("automation.enable")}
                  </Button>
                )}
                {row.canDelete && (
                  <Button
                    variant="minimal"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove.run(row)}
                  >
                    {tr("automation.delete")}
                  </Button>
                )}
              </div>
            ),
          },
        }}
      />
    </div>
  );
};

export default AutomationOverviewPage;
