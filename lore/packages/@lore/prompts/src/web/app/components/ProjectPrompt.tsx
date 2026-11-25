import { Button } from "@alepha/ui";
import { DetailLayout, type DetailTab } from "@alepha/ui/shell";
import type { HostJobController } from "@lore/core/api";
import type { PromptResource } from "@lore/core/schemas";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Clock,
  Copy,
  FileCode,
  ListChecks,
  Pencil,
  Pin,
  Play,
  Power,
  PowerOff,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import type { PromptController } from "../../../api/controllers/PromptController.ts";
import ProjectPromptAside from "./ProjectPromptAside.tsx";
import PromptEditorDialog from "./run/PromptEditorDialog.tsx";
import PromptPinsDialog from "./run/PromptPinsDialog.tsx";
import PromptRunDialog from "./run/PromptRunDialog.tsx";
import PromptTriggerDialog from "./run/PromptTriggerDialog.tsx";
import { usePromptActions } from "./run/usePromptActions.ts";

export interface ProjectPromptProps {
  name: string;
}

type Open =
  | { kind: "copy" | "run" | "trigger" | "pins" }
  | { kind: "editor"; mode: "duplicate" | "edit" | "source" };

/**
 * One prompt on its own page (#Q4326), on the detail shell a job uses: its
 * words in the main column, its properties in the aside, and the row
 * menu's actions in the toolbar: Copy, Run, Jobs, and for `prompt:manage`
 * Duplicate, Pins, Trigger, its switch, and Edit (a custom prompt) or
 * Source (a built-in). Read from the project's prompt list, the one key
 * every prompt write refreshes.
 */
const ProjectPrompt = (props: ProjectPromptProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<PromptController>();
  const jobsApi = useClient<HostJobController>();
  // Core's own pages; typed for them from here.
  const router = useRouter<any>();
  const queries = useQueryClient();
  const [project] = useStore(currentProjectAtom);
  const [open, setOpen] = useState<Open | undefined>();
  const projectId = project?.id;
  const slug = project?.slug ?? String(projectId ?? "");
  const manage = can("prompt:manage");
  const key = ["project-prompts", projectId];
  const { copy, run } = usePromptActions(projectId, slug);

  const list = useQuery(
    {
      enabled: projectId !== undefined,
      key,
      handler: () =>
        api.listPrompts({ params: { projectId: projectId as number } }),
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
  const prompt = list.data?.items.find((it) => it.name === props.name);
  const last = useQuery(
    {
      enabled: !!prompt?.lastJobId && can("host:read"),
      key: ["project-job", prompt?.lastJobId],
      handler: () =>
        jobsApi.getJob({ params: { jobId: prompt?.lastJobId as string } }),
      onError: () => {},
    },
    [jobsApi, prompt?.lastJobId],
  );
  const ready = (hosts.data?.hosts ?? []).length > 0;
  const refresh = () => queries.invalidate(key);
  const update = useAction<
    [body: { enabled?: boolean; pins?: string[] }],
    void
  >(
    {
      handler: async (_context, body) => {
        if (projectId === undefined || !prompt) return;
        await api.updatePrompt({
          params: { projectId, name: prompt.name },
          body,
        });
      },
      invalidates: [key],
    },
    [api, projectId, prompt?.name],
  );

  const busy = copy.loading || run.loading || update.loading;
  const triggered = prompt && prompt.on !== "manual";
  const startCopy = (row: PromptResource) => {
    if (row.args.every((arg) => arg.type === "member")) {
      void copy.run(row.name, {});
      return;
    }
    setOpen({ kind: "copy" });
  };

  const tabs: DetailTab[] = [{ value: "text", label: tr("prompts.tab.text") }];
  const action = (
    label: string,
    Icon: typeof Copy,
    onClick: () => void,
    testId?: string,
  ) => (
    <Button
      key={label}
      variant="outlined"
      size="lg"
      disabled={busy}
      onClick={onClick}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <Icon className="size-4" />
      {label}
    </Button>
  );
  const actions = prompt && (
    <>
      {action(
        tr("prompts.copy"),
        Copy,
        () => startCopy(prompt),
        "prompt-page-copy",
      )}
      {ready &&
        can(prompt.permission) &&
        action(
          tr("prompts.run"),
          Play,
          () => setOpen({ kind: "run" }),
          "prompt-page-run",
        )}
      {can("host:read") &&
        action(
          tr("prompts.jobs"),
          ListChecks,
          () =>
            void router.push("projectSettingsPromptJobs", {
              params: { projectSlug: slug },
              query: { prompt: prompt.name },
            }),
        )}
      {manage && (
        <>
          {action(tr("prompts.duplicate"), Sparkles, () =>
            setOpen({ kind: "editor", mode: "duplicate" }),
          )}
          {action(tr("prompts.pin"), Pin, () => setOpen({ kind: "pins" }))}
          {action(tr("prompts.trigger"), Clock, () =>
            setOpen({ kind: "trigger" }),
          )}
          {triggered &&
            action(
              tr(
                prompt.enabled
                  ? "prompts.trigger.disable"
                  : "prompts.trigger.enable",
              ),
              prompt.enabled ? PowerOff : Power,
              () => void update.run({ enabled: !prompt.enabled }),
              "prompt-page-switch",
            )}
          {prompt.builtin
            ? action(tr("prompts.source"), FileCode, () =>
                setOpen({ kind: "editor", mode: "source" }),
              )
            : action(tr("prompts.edit"), Pencil, () =>
                setOpen({ kind: "editor", mode: "edit" }),
              )}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project-prompt">
      <DetailLayout
        loading={!list.data && list.loading}
        {...(list.data && !prompt
          ? {
              notFound: {
                message: tr("prompts.notFound", { args: [props.name] }),
                backLabel: tr("prompts.title"),
                onBack: () =>
                  void router.push("projectSettingsPrompts", {
                    params: { projectSlug: slug },
                  }),
              },
            }
          : {})}
        aside={
          prompt && (
            <ProjectPromptAside
              prompt={prompt}
              projectSlug={slug}
              pages={list.data?.pages ?? []}
              {...(last.data?.status ? { lastStatus: last.data.status } : {})}
            />
          )
        }
        tabs={tabs}
        tab="text"
        onTabChange={() => {}}
        actions={actions}
      >
        {prompt && (
          <pre
            className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs break-words whitespace-pre-wrap"
            data-testid="prompt-page-text"
          >
            {prompt.text}
          </pre>
        )}
      </DetailLayout>
      {projectId !== undefined &&
        prompt &&
        (open?.kind === "copy" || open?.kind === "run") && (
          <PromptRunDialog
            open
            onOpenChange={(next) => !next && setOpen(undefined)}
            projectId={projectId}
            prompt={prompt}
            mode={open.kind}
            hosts={hosts.data?.hosts}
            busy={busy}
            onSubmit={async (body) => {
              const done =
                open.kind === "copy"
                  ? await copy.run(prompt.name, body.args)
                  : await run.run(prompt.name, body);
              if (done.ok) setOpen(undefined);
            }}
          />
        )}
      {prompt && open?.kind === "pins" && (
        <PromptPinsDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          prompt={prompt}
          pages={list.data?.pages ?? []}
          onSave={(pins) => void update.run({ pins })}
        />
      )}
      {projectId !== undefined && prompt && open?.kind === "trigger" && (
        <PromptTriggerDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          prompt={prompt}
          onSaved={refresh}
        />
      )}
      {projectId !== undefined && prompt && open?.kind === "editor" && (
        <PromptEditorDialog
          open
          onOpenChange={(next) => !next && setOpen(undefined)}
          projectId={projectId}
          mode={open.mode}
          prompt={prompt}
          onSaved={(row) => {
            refresh();
            // A duplicate is a new prompt: open its page.
            if (open.mode === "duplicate")
              void router.push("projectPrompt", {
                params: { projectSlug: slug, name: row.name },
              });
          }}
        />
      )}
    </div>
  );
};

export default ProjectPrompt;
