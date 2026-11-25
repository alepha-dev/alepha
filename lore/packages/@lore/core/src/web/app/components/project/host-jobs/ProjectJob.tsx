import { Button, cn } from "@alepha/ui";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import type { PromptController } from "../../../../../api/controllers/PromptController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { type I18n } from "../../../services/I18n.ts";
import JobHistoryRail from "./JobHistoryRail.tsx";
import JobLogViewer from "./JobLogViewer.tsx";
import JobStatusBadge from "./JobStatusBadge.tsx";
import { jobInFlight } from "./jobStatusIcon.ts";
import ProjectJobRun from "./ProjectJobRun.tsx";

export interface ProjectJobProps {
  jobId: string;
}

/**
 * One host job (#Q3984), laid out as Chat is since #Q4207: the project's job
 * history on the left, the open job's header, its details and its log on
 * the right, the log in a viewer that follows the output while it runs.
 *
 * The log is read by byte offsets: each poll asks for what lies past what
 * the page already holds, every two seconds while the job is in flight,
 * and stops once it has ended.
 */
const ProjectJob = ({ jobId }: ProjectJobProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const promptApi = useClient<PromptController>();
  const [project] = useStore(currentProjectAtom);
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

  const cancel = useAction<[], void>(
    {
      handler: async () => {
        await api.cancelJob({ params: { jobId } });
        await job.refetch();
      },
    },
    [jobId],
  );

  const row = job.data?.id === jobId ? job.data : undefined;
  // The prompt's title, when the project still has it (#Q4281).
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
  const inFlight = row ? jobInFlight(row.status) : false;
  const slug = project?.slug ?? String(project?.id ?? "");

  const details: Array<[string, string | number]> = row
    ? [
        [tr("jobs.field.host"), row.hostSlug ?? ""],
        // What it ran and where (#Q4222): the agent CLI, its model (the
        // CLI's own default when none is named) and the workspace.
        ...(row.input.agent
          ? ([[tr("jobs.field.agent"), row.input.agent]] as Array<
              [string, string]
            >)
          : []),
        ...(row.input.model
          ? ([[tr("jobs.field.model"), row.input.model]] as Array<
              [string, string]
            >)
          : []),
        ...(row.input.workspace
          ? ([[tr("jobs.field.workspace"), row.input.workspace]] as Array<
              [string, string]
            >)
          : []),
        // The code it found (#E173): the source, its ref or branch, and the
        // commit the host resolved.
        ...(row.input.source
          ? ([
              [
                tr("jobs.field.source"),
                {
                  none: tr("jobs.source.none"),
                  read: tr("jobs.source.read"),
                  write: tr("jobs.source.write"),
                }[row.input.source.mode],
              ],
            ] as Array<[string, string]>)
          : []),
        ...(row.input.source?.ref
          ? ([[tr("jobs.field.ref"), row.input.source.ref]] as Array<
              [string, string]
            >)
          : []),
        ...(row.input.source?.branch
          ? ([[tr("jobs.field.branch"), row.input.source.branch]] as Array<
              [string, string]
            >)
          : []),
        ...(row.commit
          ? ([[tr("jobs.field.commit"), row.commit.slice(0, 12)]] as Array<
              [string, string]
            >)
          : []),
        ...(row.subjectType
          ? ([
              [
                tr("jobs.field.subject"),
                `${row.subjectType} ${row.subjectId ?? ""}`,
              ],
            ] as Array<[string, string]>)
          : []),
        [tr("jobs.field.queued"), l(row.queuedAt, { date: "lll" })],
        ...(row.endedAt
          ? ([
              [tr("jobs.field.ended"), l(row.endedAt, { date: "lll" })],
            ] as Array<[string, string]>)
          : []),
        ...(row.exitCode !== undefined
          ? ([[tr("jobs.field.exit"), row.exitCode]] as Array<[string, number]>)
          : []),
        // A write worktree the host kept with work not pushed (#Q4247).
        ...(row.warning
          ? ([[tr("jobs.field.warning"), row.warning]] as Array<
              [string, string]
            >)
          : []),
      ]
    : [];

  return (
    <div
      className="grid h-full min-h-0 md:grid-cols-[18rem_1fr]"
      data-testid="project-job"
    >
      {project && (
        <JobHistoryRail
          projectId={project.id}
          projectSlug={slug}
          selectedId={jobId}
          className="hidden md:flex"
        />
      )}
      <div className="bg-card flex min-h-0 min-w-0 flex-col">
        {/* The rail header's twin: 46px and a bottom rule. */}
        <div className="flex h-[46px] shrink-0 items-center gap-2 border-b px-4">
          {row && (
            <>
              <h1 className="truncate text-sm font-semibold">{row.kind}</h1>
              <JobStatusBadge status={row.status} />
              {inFlight && (
                <Button
                  variant="outlined"
                  size="sm"
                  className="ms-auto"
                  disabled={cancel.loading}
                  onClick={() => void cancel.run()}
                  data-testid="job-cancel"
                >
                  {tr("jobs.cancel")}
                </Button>
              )}
            </>
          )}
        </div>
        {row && (
          <dl className="grid shrink-0 grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border-b px-4 py-3 text-sm sm:grid-cols-[max-content_1fr_max-content_1fr]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 truncate">{value}</dd>
              </div>
            ))}
            {row.reason && (
              <div className="contents">
                <dt className="text-muted-foreground">
                  {tr("jobs.field.reason")}
                </dt>
                <dd
                  className={cn(
                    "font-mono text-xs sm:col-span-3",
                    "break-words",
                  )}
                >
                  {row.reason}
                </dd>
              </div>
            )}
          </dl>
        )}
        {row && (
          <ProjectJobRun
            job={row}
            projectSlug={slug}
            promptTitle={
              prompts.data?.items.find((it) => it.name === row.prompt)?.title
            }
          />
        )}
        <JobLogViewer
          stdout={log.stdout}
          stderr={log.stderr}
          live={live && (row ? inFlight : true)}
          truncated={row?.logTruncated}
        />
      </div>
    </div>
  );
};

export default ProjectJob;
