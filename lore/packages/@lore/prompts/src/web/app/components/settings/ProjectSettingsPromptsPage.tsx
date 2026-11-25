import {
  Badge,
  cn,
  textLinkUnderlineClassName,
  TimeAgo,
  useDialog,
} from "@alepha/ui";
import {
  DataTable,
  type RowActionContext,
  type RowActionEntry,
} from "@alepha/ui/table";
import type { HostJobController } from "@lore/core/api";
import type { PromptResource } from "@lore/core/schemas";
import {
  type I18n,
  currentProjectAtom,
  useOptimisticWrite,
  useRank,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import {
  useClient,
  useInject,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
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

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";
import PromptEditorDialog from "../run/PromptEditorDialog.tsx";
import PromptEnabledCell from "../run/PromptEnabledCell.tsx";
import PromptPinsDialog from "../run/PromptPinsDialog.tsx";
import PromptRunDialog from "../run/PromptRunDialog.tsx";
import PromptTriggerDialog from "../run/PromptTriggerDialog.tsx";
import PromptViewDialog from "../run/PromptViewDialog.tsx";
import { usePromptActions } from "../run/usePromptActions.ts";

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
 *
 * A write changes its row in place (#Q4301), as on Quests and Epics, and
 * never refetches the list, which blanked the table. The switch, the pins,
 * a pause and a delete are optimistic: the screen changes in the click's
 * frame, the request leaves, and a refusal puts it back. A trigger or an
 * editor save waits for the server, which checks it and answers the row
 * drawn in its place; its dialog stays open on a refusal, on the field.
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
      // Anything that still invalidates the list (a copy, a run, another
      // tab's write) refetches under the rows on screen, never a blank.
      keepPreviousData: true,
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

  const queries = useQueryClient();
  const optimistic = useOptimisticWrite();
  const dateTime = useInject(DateTimeProvider);
  type List = NonNullable<typeof list.data>;
  const edit = (change: (list: List) => List) =>
    queries.setData<List | undefined>(key, (previous) =>
      previous ? change(previous) : previous,
    );
  /**
   * Draw a row as the server answered it, or append it when it is new
   * (a duplicate, a new prompt).
   */
  const put = (row: PromptResource) =>
    edit((it) => ({
      ...it,
      items: it.items.some((item) => item.name === row.name)
        ? it.items.map((item) => (item.name === row.name ? row : item))
        : [...it.items, row],
    }));
  /**
   * An optimistic change to one row: drawn now, sent at once, put back as
   * it was when the server refuses it, and replaced by the server's row
   * when it agrees.
   */
  const patch = (
    row: PromptResource,
    change: Partial<PromptResource>,
    body: { enabled?: boolean; pins?: string[] },
  ) => {
    if (projectId === undefined) return;
    void optimistic.run({
      apply: () => {
        put({ ...row, ...change });
        return () => put(row);
      },
      commit: async () =>
        put(
          await api.updatePrompt({
            params: { projectId, name: row.name },
            body,
          }),
        ),
    });
  };
  const remove = async (
    row: PromptResource,
    ctx: RowActionContext<PromptResource>,
  ) => {
    if (projectId === undefined) return;
    const sure = await dialog.confirm({
      title: tr("prompts.delete.title", { args: [row.title] }),
      description: tr("prompts.delete.description"),
      destructive: true,
    });
    if (!sure) return;
    void optimistic.run({
      // The row plays its exit at once; it leaves the list once the server
      // agreed, and comes back when it refuses.
      apply: () => ctx.optimistic.remove(row),
      commit: () => api.deletePrompt({ params: { projectId, name: row.name } }),
      onCommitted: () =>
        edit((it) => ({
          ...it,
          items: it.items.filter((item) => item.name !== row.name),
        })),
    });
  };
  const pause = (paused: boolean) => {
    if (projectId === undefined) return;
    const before = list.data?.pausedAt;
    const setPausedAt = (pausedAt: string | undefined) =>
      edit((it) => ({ ...it, pausedAt }));
    void optimistic.run({
      apply: () => {
        setPausedAt(paused ? dateTime.nowISOString() : undefined);
        return () => setPausedAt(before);
      },
      commit: async () =>
        setPausedAt(
          (
            await api.setPromptsPaused({
              params: { projectId },
              body: { paused },
            })
          ).pausedAt,
        ),
    });
  };
  const busy = copy.loading;

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
                  onClick: (_item: PromptResource, ctx: RowActionContext) =>
                    void remove(row, ctx as RowActionContext<PromptResource>),
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
              onClick: () => pause(!pausedAt),
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
                    onChange={(enabled) => patch(row, { enabled }, { enabled })}
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
      {open?.kind === "pins" && (
        <PromptPinsDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          prompt={open.prompt}
          pages={pages}
          onSave={(pins) => patch(open.prompt, { pins }, { pins })}
        />
      )}
      {projectId !== undefined && open?.kind === "trigger" && (
        <PromptTriggerDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          prompt={open.prompt}
          onSaved={put}
        />
      )}
      {projectId !== undefined && open?.kind === "editor" && (
        <PromptEditorDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          mode={open.mode}
          prompt={open.prompt}
          onSaved={put}
        />
      )}
    </div>
  );
};

export default ProjectSettingsPromptsPage;
