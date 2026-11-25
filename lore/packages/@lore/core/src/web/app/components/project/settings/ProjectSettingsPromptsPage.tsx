import {
  Badge,
  cn,
  textLinkUnderlineClassName,
  TimeAgo,
  useDialog,
} from "@alepha/ui";
import { DataTable, type RowActionEntry } from "@alepha/ui/table";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Clock,
  Copy,
  Eye,
  FileCode,
  ListChecks,
  Pin,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import type { PromptController } from "../../../../../api/controllers/PromptController.ts";
import type { PromptResource } from "../../../../../api/schemas/promptResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { type I18n } from "../../../services/I18n.ts";
import { useRank } from "../../shared/useRank.ts";
import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";
import PromptEditorDialog from "../prompts/run/PromptEditorDialog.tsx";
import PromptEnabledCell from "../prompts/run/PromptEnabledCell.tsx";
import PromptPinsDialog from "../prompts/run/PromptPinsDialog.tsx";
import PromptRunDialog from "../prompts/run/PromptRunDialog.tsx";
import PromptTriggerDialog from "../prompts/run/PromptTriggerDialog.tsx";
import PromptViewDialog from "../prompts/run/PromptViewDialog.tsx";
import { usePromptActions } from "../prompts/run/usePromptActions.ts";

type Open =
  | {
      kind: "copy" | "run" | "view" | "trigger" | "pins";
      prompt: PromptResource;
    }
  | {
      kind: "editor";
      mode: "create" | "duplicate" | "edit" | "source";
      prompt?: PromptResource;
    };

/**
 * Settings > Prompts, its Prompts tab (#E174, #Q4280): the built-ins, then
 * the project's custom prompts. Every member reads and copies; `prompt:
 * manage` writes, sets triggers and pauses them; Run is offered with a ready
 * Agent host only, and needs the prompt's own permission (the server says).
 */
const ProjectSettingsPromptsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<PromptController>();
  const jobsApi = useClient<HostJobController>();
  const dialog = useDialog();
  // Core's own settings page; typed for it from here.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const [open, setOpen] = useState<Open | undefined>();
  const manage = can("prompt:manage");
  const projectId = project?.id;
  const slug = project?.slug ?? String(projectId ?? "");
  const key = ["project-prompts", projectId];
  const { copy, run } = usePromptActions(projectId, slug);

  const list = useQuery(
    {
      enabled: projectId !== undefined,
      key,
      handler: () =>
        api.listPrompts({ params: { projectId: projectId as number } }),
    },
    [api, projectId],
  );
  const hosts = useQuery(
    {
      enabled: projectId !== undefined && can("host:read"),
      key: ["prompt-hosts", projectId],
      handler: () =>
        api.listPromptHosts({ params: { projectId: projectId as number } }),
      onError: () => {},
    },
    [api, projectId],
  );
  const jobs = useQuery(
    {
      enabled: projectId !== undefined && can("host:read"),
      key: ["project-jobs", projectId],
      handler: () =>
        jobsApi.listProjectJobs({
          params: { projectId: projectId as number },
          query: { limit: 200 },
        }),
      onError: () => {},
    },
    [jobsApi, projectId],
  );
  const statusOf = new Map(
    (jobs.data?.items ?? []).map((job) => [job.id, job.status]),
  );
  const ready = (hosts.data?.hosts ?? []).length > 0;

  const write = useAction<[name: string, body: { enabled?: boolean }], void>(
    {
      handler: async (_ctx, name, body) => {
        if (projectId === undefined) return;
        await api.updatePrompt({ params: { projectId, name }, body });
      },
      invalidates: [key],
    },
    [api, projectId],
  );
  const remove = useAction<[prompt: PromptResource], void>(
    {
      handler: async (_ctx, prompt) => {
        if (projectId === undefined) return;
        const sure = await dialog.confirm({
          title: tr("prompts.delete.title", { args: [prompt.title] }),
          description: tr("prompts.delete.description"),
          destructive: true,
        });
        if (!sure) return;
        await api.deletePrompt({
          params: { projectId, name: prompt.name },
        });
      },
      invalidates: [key],
    },
    [api, projectId, dialog],
  );
  const pause = useAction<[paused: boolean], void>(
    {
      handler: async (_ctx, paused) => {
        if (projectId === undefined) return;
        await api.setPromptsPaused({ params: { projectId }, body: { paused } });
      },
      invalidates: [key],
    },
    [api, projectId],
  );
  const busy = write.loading || remove.loading || pause.loading || copy.loading;

  const startCopy = (prompt: PromptResource) => {
    if (prompt.args.every((arg) => arg.type === "member")) {
      void copy.run(prompt.name, {});
      return;
    }
    setOpen({ kind: "copy", prompt });
  };

  const rowActions = (
    row: PromptResource,
  ): RowActionEntry<PromptResource>[] => [
    {
      icon: Copy,
      label: tr("prompts.copy"),
      disabled: () => busy,
      onClick: () => startCopy(row),
    },
    ...(ready
      ? [
          {
            icon: Play,
            label: tr("prompts.run"),
            disabled: () => busy,
            onClick: () => setOpen({ kind: "run", prompt: row }),
          },
        ]
      : []),
    {
      icon: Eye,
      label: tr("prompts.view"),
      onClick: () => setOpen({ kind: "view", prompt: row }),
    },
    ...(can("host:read")
      ? [
          {
            // Every run of this prompt: the Jobs tab, filtered on it.
            icon: ListChecks,
            label: tr("prompts.jobs"),
            onClick: () =>
              void router.push("projectSettingsPromptJobs", {
                params: { projectSlug: slug },
                query: { prompt: row.name },
              }),
          },
        ]
      : []),
    ...(manage
      ? [
          {
            icon: Sparkles,
            label: tr("prompts.duplicate"),
            onClick: () =>
              setOpen({ kind: "editor", mode: "duplicate", prompt: row }),
          },
          {
            icon: Pin,
            label: tr("prompts.pin"),
            onClick: () => setOpen({ kind: "pins", prompt: row }),
          },
          {
            icon: Clock,
            label: tr("prompts.trigger"),
            onClick: () => setOpen({ kind: "trigger", prompt: row }),
          },
          row.builtin
            ? {
                icon: FileCode,
                label: tr("prompts.source"),
                onClick: () =>
                  setOpen({ kind: "editor", mode: "source", prompt: row }),
              }
            : {
                icon: Pencil,
                label: tr("prompts.edit"),
                onClick: () =>
                  setOpen({ kind: "editor", mode: "edit", prompt: row }),
              },
          ...(row.builtin
            ? []
            : [
                {
                  icon: Trash2,
                  label: tr("prompts.delete"),
                  disabled: () => busy,
                  onClick: () => void remove.run(row),
                },
              ]),
        ]
      : []),
  ];

  const pausedAt = list.data?.pausedAt;
  const pages = list.data?.pages ?? [];

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col gap-4 md:-m-6">
      {list.data && (
        <DataTable<PromptResource>
          className="min-h-0 flex-1"
          flat
          data={list.data.items}
          rowKey={(row) => row.name}
          defaultSize={100}
          // The toolbar draws its actions in this order: Pause / Resume
          // first, left of the primary New prompt (#Q4292).
          actions={[
            {
              icon: pausedAt ? Play : Pause,
              label: pausedAt ? tr("prompts.resume") : tr("prompts.pause"),
              disabled: !manage || busy,
              onClick: () => void pause.run(!pausedAt),
            },
            {
              icon: Plus,
              label: tr("prompts.new"),
              primary: true,
              disabled: !manage,
              onClick: () => setOpen({ kind: "editor", mode: "create" }),
            },
          ]}
          rowActions={rowActions}
          columns={{
            name: {
              label: tr("prompts.table.prompt"),
              cell: (row) => (
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    <span data-testid="prompt-title">{row.title}</span>
                    {row.builtin && (
                      <Badge variant="secondary">{tr("prompts.builtin")}</Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {row.name}
                  </span>
                </span>
              ),
            },
            args: {
              label: tr("prompts.table.args"),
              cell: (row) => (
                <span className="text-xs">
                  {row.args.length
                    ? row.args
                        .map((arg) => tr(`prompts.arg.${arg.type}`))
                        .join(", ")
                    : tr("prompts.args.none")}
                </span>
              ),
            },
            source: {
              label: tr("prompts.source"),
              cell: (row) => (
                <span className="text-xs">
                  {tr(`prompts.source.${row.source}`)}
                </span>
              ),
            },
            on: {
              label: tr("prompts.table.trigger"),
              cell: (row) => (
                <span className="text-xs" data-testid="prompt-on">
                  {row.on === "manual" ? tr("prompts.trigger.manual") : row.on}
                  {row.check?.length
                    ? ` · ${tr("prompts.trigger.checks", { args: [row.check.join(", ")] })}`
                    : ""}
                </span>
              ),
            },
            pins: {
              label: tr("prompts.table.pins"),
              cell: (row) => (
                <span className="text-xs" data-testid="prompt-pins-cell">
                  {row.pins.length
                    ? row.pins
                        .map((key) =>
                          tr(`prompts.page.${key}`, {
                            default:
                              pages.find((it) => it.key === key)?.label ?? key,
                          }),
                        )
                        .join(", ")
                    : tr("prompts.pins.none")}
                </span>
              ),
            },
            lastRunAt: {
              label: tr("prompts.table.lastRun"),
              cell: (row) => {
                if (
                  row.lastSkippedReason &&
                  (row.lastSkippedAt ?? "") > (row.lastRunAt ?? "")
                ) {
                  return (
                    <span className="text-muted-foreground text-xs">
                      {tr("prompts.skipped", { args: [row.lastSkippedReason] })}
                    </span>
                  );
                }
                if (!row.lastJobId || !row.lastRunAt) {
                  return (
                    <span className="text-muted-foreground text-xs">
                      {tr("prompts.never")}
                    </span>
                  );
                }
                const status = statusOf.get(row.lastJobId);
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
            enabled: {
              label: tr("prompts.table.enabled"),
              cell: (row) =>
                row.on === "manual" ? null : (
                  <PromptEnabledCell
                    key={`${row.name}:${row.enabled}`}
                    enabled={row.enabled}
                    disabled={!manage || busy}
                    label={tr("prompts.table.enabled")}
                    onChange={(enabled) =>
                      void write.run(row.name, { enabled })
                    }
                  />
                ),
            },
          }}
        />
      )}
      {/* What the table cannot say: a missing Agent host and a pause. The
      guide link that sat between them went at the owner's request (#Q4291),
      so the separator only falls between two items that are both there. */}
      {((!ready && can("host:read")) || pausedAt) && (
        <p className="text-muted-foreground px-4 pb-4 text-xs md:px-6">
          {!ready && can("host:read") && (
            <span data-testid="prompts-needs-host">
              {tr("prompts.needsHost")}{" "}
              <Link
                href={`/${slug}/settings/hosts`}
                className={textLinkUnderlineClassName}
              >
                {tr("project.settings.nav.hosts")}
              </Link>
            </span>
          )}
          {!ready && can("host:read") && pausedAt && " · "}
          {pausedAt && (
            <span data-testid="prompts-paused">
              {tr("prompts.paused")} <TimeAgo value={pausedAt} />
            </span>
          )}
        </p>
      )}
      {projectId !== undefined &&
        (open?.kind === "copy" || open?.kind === "run") && (
          <PromptRunDialog
            open
            onOpenChange={(next) => !next && setOpen(undefined)}
            projectId={projectId}
            prompt={open.prompt}
            mode={open.kind}
            hosts={hosts.data?.hosts}
            busy={copy.loading || run.loading}
            onSubmit={async (body) => {
              const done =
                open.kind === "copy"
                  ? await copy.run(open.prompt.name, body.args)
                  : await run.run(open.prompt.name, body);
              if (done.ok) setOpen(undefined);
            }}
          />
        )}
      {open?.kind === "view" && (
        <PromptViewDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          prompt={open.prompt}
        />
      )}
      {projectId !== undefined && open?.kind === "pins" && (
        <PromptPinsDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          prompt={open.prompt}
          pages={pages}
          invalidates={key}
        />
      )}
      {projectId !== undefined && open?.kind === "trigger" && (
        <PromptTriggerDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          prompt={open.prompt}
          invalidates={key}
        />
      )}
      {projectId !== undefined && open?.kind === "editor" && (
        <PromptEditorDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          mode={open.mode}
          prompt={open.prompt}
          invalidates={key}
        />
      )}
    </div>
  );
};

export default ProjectSettingsPromptsPage;
