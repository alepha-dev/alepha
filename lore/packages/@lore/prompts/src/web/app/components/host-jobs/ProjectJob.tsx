import { Button, useToast } from "@alepha/ui";
import { DetailLayout, type DetailTab, useDetailTab } from "@alepha/ui/shell";
import type { HostJobController } from "@lore/core/api";
import {
  AgentTranscript,
  type AgentTranscriptTotals,
  type HostJobResource,
} from "@lore/core/schemas";
import { type I18n, currentProjectAtom } from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Copy, Download, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import { usePromptActions } from "../run/usePromptActions.ts";
import JobLogViewer from "./JobLogViewer.tsx";
import { jobInFlight } from "./jobStatusIcon.ts";
import ProjectJobAside from "./ProjectJobAside.tsx";
import ProjectJobTranscript from "./ProjectJobTranscript.tsx";

export interface ProjectJobProps {
  jobId: string;
}

type TabKey = "transcript" | "log" | "prompt";

/**
 * One job (#Q4286), on the detail shell every detail page shares: the job
 * titled by its prompt and args in the aside, and three tabs, kept in the
 * URL: Transcript (the reply, then what the agent said and did), Raw log,
 * and the Prompt it received. The toolbar downloads the log, copies the
 * prompt, and runs it again or cancels it. No rail of other jobs: the list
 * is the Jobs tab of Settings > Prompts, which the crumb leads back to.
 *
 * The log is read by byte offsets: each poll asks for what lies past what
 * the page already holds, every two seconds while the job is in flight,
 * and stops once it has ended.
 */
const ProjectJob = (props: ProjectJobProps) => {
  const { tr } = useI18n<I18n, "en">();
  const jobId = props.jobId;
  const api = useClient<HostJobController>();
  const promptApi = useClient<PromptController>();
  const toaster = useToast();
  // A page name another router declares: the Jobs tab is core's own.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const slug = project?.slug ?? String(project?.id ?? "");
  const [tab, setTab] = useDetailTab<TabKey>("transcript");
  const { run } = usePromptActions(project?.id, slug);
  // Keyed by the job it holds, so moving to another job starts it empty.
  const [held, setLog] = useState({ jobId, stdout: "", stderr: "" });
  const log = held.jobId === jobId ? held : { stdout: "", stderr: "" };
  // Keyed by its job too: a job just opened is live until its log says not.
  const [liveOf, setLiveOf] = useState({ jobId, live: true });
  const live = liveOf.jobId === jobId ? liveOf.live : true;

  const job = useQuery(
    {
      key: ["host-job", jobId],
      keepPreviousData: true,
      runEvery: live ? 3000 : undefined,
      handler: async () => api.getJob({ params: { jobId } }),
    },
    [jobId, live],
  );

  useEffect(() => {
    let stopped = false;
    let offsets = { stdout: 0, stderr: 0 };
    const poll = async () => {
      while (!stopped) {
        const part = await api
          .getJobLog({ params: { jobId }, query: offsets })
          .catch(() => undefined);
        if (stopped || !part) return;
        offsets = part.next;
        if (part.stdout || part.stderr) {
          setLog((current) =>
            current.jobId === jobId
              ? {
                  jobId,
                  stdout: current.stdout + part.stdout,
                  stderr: current.stderr + part.stderr,
                }
              : { jobId, stdout: part.stdout, stderr: part.stderr },
          );
        }
        setLiveOf({ jobId, live: part.live });
        if (!part.live) return;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 2000));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [jobId]);

  const row = job.data?.id === jobId ? job.data : undefined;
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
  const transcript = useMemo(
    () => AgentTranscript.parse(log.stdout, row?.input.agent),
    [log.stdout, row?.input.agent],
  );

  const cancel = useAction<[], void>(
    {
      handler: async () => {
        await api.cancelJob({ params: { jobId } });
        await job.refetch();
      },
    },
    [jobId],
  );

  const inFlight = row ? jobInFlight(row.status) : true;
  const tabs: DetailTab[] = [
    {
      value: "transcript",
      label: tr("jobs.tab.transcript"),
      count: transcript.entries.length || undefined,
    },
    { value: "log", label: tr("jobs.tab.log") },
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
  const runAgain = (continued: boolean) =>
    row &&
    prompt &&
    run.run(prompt.name, {
      args: Object.fromEntries(
        (row.args ?? []).map((arg) => [arg.name, arg.value]),
      ),
      ...(row.hostSlug ? { host: row.hostSlug } : {}),
      ...(continued ? { continue: row.id } : {}),
    });

  const actions = row && (
    <>
      <Button variant="outlined" size="lg" onClick={download}>
        <Download className="size-4" />
        {tr("jobs.downloadLog")}
      </Button>
      {row.input.prompt && (
        <Button
          variant="outlined"
          size="lg"
          onClick={() => void copyPrompt.run()}
        >
          <Copy className="size-4" />
          {tr("jobs.copyPrompt")}
        </Button>
      )}
      {inFlight ? (
        <Button
          variant="outlined"
          size="lg"
          disabled={cancel.loading}
          onClick={() => void cancel.run()}
          data-testid="job-cancel"
        >
          <Square className="size-4" />
          {tr("jobs.cancel")}
        </Button>
      ) : (
        prompt && (
          <>
            {unfinished && (
              <Button
                variant="outlined"
                size="lg"
                disabled={run.loading}
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
              onClick={() => void runAgain(unfinished)}
              data-testid="job-run-again"
            >
              <Play className="size-4" />
              {tr("jobs.runAgain")}
            </Button>
          </>
        )
      )}
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
        {row && tab === "log" && (
          <JobLogViewer
            stdout={log.stdout}
            stderr={log.stderr}
            live={live && inFlight}
            truncated={row.logTruncated}
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
