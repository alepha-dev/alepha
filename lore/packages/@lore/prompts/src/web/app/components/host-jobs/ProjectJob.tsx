import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDialog,
  useToast,
} from "@alepha/ui";
import { DetailLayout, type DetailTab, useDetailTab } from "@alepha/ui/shell";
import type { HostJobController } from "@lore/core/api";
import type {
  AgentTranscriptTotals,
  HostJobResource,
} from "@lore/core/schemas";
import { type I18n, currentProjectAtom, usePageCrumb } from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Copy,
  Download,
  MessageSquare,
  MoreVertical,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import { usePromptActions } from "../run/usePromptActions.ts";
import ProjectJobAside from "./ProjectJobAside.tsx";
import ProjectJobPokeDialog from "./ProjectJobPokeDialog.tsx";
import ProjectJobTranscript from "./ProjectJobTranscript.tsx";
import { useJobReader } from "./useJobReader.ts";

export interface ProjectJobProps {
  jobId: string;
}

type TabKey = "transcript" | "prompt";

/**
 * One job (#Q4286), on the detail shell every detail page shares: the job
 * titled by its prompt and args in the aside, and two tabs, kept in the
 * URL: Transcript (the reply, then what the agent said and did) and the
 * Prompt it received; the raw log is the toolbar's download since #Q4403,
 * and the transcript is parsed from it. The toolbar runs the job again, and
 * its "…" menu downloads the log, copies the prompt or cancels a job in
 * flight (#Q4448). No rail of other jobs: the list
 * is the Jobs tab of Settings > Prompts, which the crumb leads back to.
 *
 * The log is read by byte offsets: each poll asks for what lies past what
 * the page already holds, every two seconds while the job is in flight,
 * and stops once it has ended. The reading is `useJobReader`'s, which the
 * side panel shares (#Q4515).
 */
const ProjectJob = (props: ProjectJobProps) => {
  const { tr } = useI18n<I18n, "en">();
  const jobId = props.jobId;
  const api = useClient<HostJobController>();
  const promptApi = useClient<PromptController>();
  const toaster = useToast();
  const dialog = useDialog();
  // A page name another router declares: the Jobs tab is core's own.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const slug = project?.slug ?? String(project?.id ?? "");
  const [asked, setTab] = useDetailTab<TabKey>("transcript");
  // A stale `?tab=log`, from when the page had a Raw log tab (#Q4403), opens
  // the transcript.
  const tab: TabKey = asked === "prompt" ? "prompt" : "transcript";
  // Run again and Start fresh open the new job's page (#Q4514): the member
  // is already watching a job here.
  const { run } = usePromptActions(project?.id, slug, { open: true });
  // The job and its log, read through the hook the side panel shares
  // (#Q4515).
  const { job, row, log, live, transcript, inFlight } = useJobReader(jobId);

  const prompts = useQuery(
    {
      enabled: Boolean(project) && Boolean(row?.prompt),
      key: ["project-prompts", project?.id],
      handler: () =>
        promptApi.listPrompts({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [promptApi, project?.id, row?.prompt],
  );
  const prompt = prompts.data?.items.find((it) => it.name === row?.prompt);
  // The trail ends with the job, named by its prompt (#Q4536), or by its
  // short id when it ran none.
  usePageCrumb(
    "projectJob",
    row ? prompt?.title || row.prompt || row.id.slice(0, 8) : undefined,
  );
  // Asked first (#Q4493): a cancel kills the agent mid-run, and the menu
  // item sits one row under harmless ones.
  const cancel = useAction<[], void>(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("jobs.cancel.title"),
          description: tr("jobs.cancel.confirm"),
          confirmLabel: tr("jobs.cancel.yes"),
          cancelLabel: tr("jobs.cancel.no"),
          destructive: true,
        });
        if (!ok) return;
        await api.cancelJob({ params: { jobId } });
        await job.refetch();
      },
    },
    [jobId],
  );

  // Poke (#Q4456): offered only while the server says the job's agent and
  // its host's Bay read messages.
  const [poking, setPoking] = useState(false);
  // Which of Start fresh and Run again was pressed: that one spins.
  const [continuing, setContinuing] = useState<boolean>();
  const poke = useAction<[string], void>(
    {
      handler: async (_ctx, message) => {
        await api.pokeJob({ params: { jobId }, body: { message } });
        toaster.success(tr("jobs.poke.sent"));
        await job.refetch();
      },
    },
    [jobId],
  );

  const tabs: DetailTab[] = [
    {
      value: "transcript",
      label: tr("jobs.tab.transcript"),
      count: transcript.entries.length || undefined,
    },
    { value: "prompt", label: tr("jobs.tab.prompt") },
  ];

  const download = () => {
    const blob = new Blob(
      [log.stdout, log.stderr ? `\n--- stderr ---\n${log.stderr}` : ""],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${jobId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPrompt = useAction<[], void>(
    {
      handler: async () => {
        await navigator.clipboard.writeText(row?.input.prompt ?? "");
        toaster.success(tr("prompts.copied"));
      },
    },
    [row?.input.prompt],
  );

  // A job that ended unfinished is continued by Run again, in its
  // workspace and on its branch (#Q4340); Start fresh is the other choice.
  const unfinished =
    row !== undefined && ProjectJob.CONTINUABLE.includes(row.status);
  const runAgain = (continued: boolean) => {
    setContinuing(continued);
    return runPrompt(continued);
  };
  const runPrompt = (continued: boolean) =>
    row &&
    prompt &&
    run.run(prompt.name, {
      args: Object.fromEntries(
        (row.args ?? []).map((arg) => [arg.name, arg.value]),
      ),
      ...(row.hostSlug ? { host: row.hostSlug } : {}),
      ...(continued ? { continue: row.id } : {}),
    });

  // Download log, Copy prompt and Cancel live in one "…" menu after the
  // buttons (#Q4448), Cancel last and in the danger intent: it looked like the
  // two harmless actions beside it when all three were buttons. Run again and
  // Start fresh stay buttons, Run again being the page's primary action.
  const actions = row && (
    <>
      {!inFlight && prompt && (
        <>
          {unfinished && (
            <Button
              variant="outlined"
              size="lg"
              disabled={run.loading}
              loading={run.loading && continuing === false}
              onClick={() => void runAgain(false)}
              data-testid="job-start-fresh"
            >
              <RotateCcw className="size-4" />
              {tr("jobs.startFresh")}
            </Button>
          )}
          <Button
            size="lg"
            disabled={run.loading}
            loading={run.loading && continuing === unfinished}
            onClick={() => void runAgain(unfinished)}
            data-testid="job-run-again"
          >
            <Play className="size-4" />
            {tr("jobs.runAgain")}
          </Button>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="minimal"
              size="icon-lg"
              aria-label={tr("jobs.more")}
              title={tr("jobs.more")}
              data-testid="job-more"
            />
          }
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={download} data-testid="job-download-log">
            <Download className="size-4" />
            {tr("jobs.downloadLog")}
          </DropdownMenuItem>
          {row.input.prompt && (
            <DropdownMenuItem
              onClick={() => void copyPrompt.run()}
              data-testid="job-copy-prompt"
            >
              <Copy className="size-4" />
              {tr("jobs.copyPrompt")}
            </DropdownMenuItem>
          )}
          {row.pokeable && (
            <DropdownMenuItem
              onClick={() => setPoking(true)}
              data-testid="job-poke"
            >
              <MessageSquare className="size-4" />
              {tr("jobs.poke")}
            </DropdownMenuItem>
          )}
          {inFlight && <DropdownMenuSeparator />}
          {inFlight && (
            <DropdownMenuItem
              variant="destructive"
              disabled={cancel.loading}
              onClick={() => void cancel.run()}
              data-testid="job-cancel"
            >
              <Square className="size-4" />
              {tr("jobs.cancel")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectJobPokeDialog
        open={poking}
        onOpenChange={setPoking}
        sending={poke.loading}
        onSend={async (message) => (await poke.run(message)).ok}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project-job">
      <DetailLayout
        loading={!row && job.loading}
        {...(!row && job.error
          ? {
              notFound: {
                message: tr("jobs.notFound"),
                backLabel: tr("jobs.title"),
                onBack: () =>
                  void router.push("projectSettingsPromptJobs", {
                    params: { projectSlug: slug },
                  }),
              },
            }
          : {})}
        aside={
          row && (
            <ProjectJobAside
              job={row}
              projectSlug={slug}
              promptTitle={prompt?.title}
              // What Bay sent with the job's end (#Q4293), else what the
              // log says: an older Bay sends none.
              totals={ProjectJob.totalsOf(row) ?? transcript.totals}
              sessionModel={transcript.entries
                .map((entry) =>
                  entry.kind === "session" ? entry.model : undefined,
                )
                .find(Boolean)}
            />
          )
        }
        tabs={tabs}
        tab={tab}
        onTabChange={(next) => setTab(next as TabKey)}
        actions={actions}
      >
        {row && tab === "transcript" && (
          <ProjectJobTranscript
            job={row}
            transcript={transcript}
            live={live && inFlight}
          />
        )}
        {row && tab === "prompt" && (
          <pre
            className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs break-words whitespace-pre-wrap"
            data-testid="job-prompt-text"
          >
            {row.input.prompt ?? ""}
          </pre>
        )}
      </DetailLayout>
    </div>
  );
};

/**
 * A job's turns, tokens and cost as stored from Bay's terminal ack
 * (#Q4293), or nothing when its Bay sent none.
 */
ProjectJob.totalsOf = (
  job: HostJobResource,
): AgentTranscriptTotals | undefined =>
  job.turns === undefined &&
  job.inputTokens === undefined &&
  job.outputTokens === undefined &&
  job.costUsd === undefined
    ? undefined
    : {
        ...(job.turns === undefined ? {} : { turns: job.turns }),
        ...(job.inputTokens === undefined
          ? {}
          : { inputTokens: job.inputTokens }),
        ...(job.outputTokens === undefined
          ? {}
          : { outputTokens: job.outputTokens }),
        ...(job.costUsd === undefined ? {} : { costUsd: job.costUsd }),
      };

/**
 * The statuses Run again continues rather than starts afresh (#Q4340): the
 * server's `PromptRunService.CONTINUABLE`.
 */
ProjectJob.CONTINUABLE = ["failed", "timed_out", "cancelled"] as string[];

export default ProjectJob;
