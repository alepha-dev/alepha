import { Button, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import { type I18n } from "../../../services/I18n.ts";
import JobStatusBadge from "./JobStatusBadge.tsx";

export interface ProjectJobProps {
  jobId: string;
}

/**
 * One host job (#Q3984): what it ran, its status and its log, followed live
 * while it runs, with Cancel.
 *
 * The log is read by byte offsets: each poll asks for what lies past what
 * the page already holds, every two seconds while the job is in flight,
 * and stops once it has ended.
 */
const ProjectJob = ({ jobId }: ProjectJobProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  // Keyed by the job it holds, so moving to another job starts it empty.
  const [held, setLog] = useState({ jobId, stdout: "", stderr: "" });
  const log = held.jobId === jobId ? held : { stdout: "", stderr: "" };
  const [live, setLive] = useState(true);

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
        setLive(part.live);
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

  const row = job.data;
  if (!row) return null;
  const inFlight = row.status === "queued" || row.status === "running";

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="project-job">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <span>{row.kind}</span>
            <JobStatusBadge status={row.status} />
          </CardTitle>
          {inFlight && (
            <Button
              variant="outlined"
              size="sm"
              disabled={cancel.loading}
              onClick={() => void cancel.run()}
              data-testid="job-cancel"
            >
              {tr("jobs.cancel")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{tr("jobs.field.host")}</dt>
            <dd>{row.hostSlug ?? ""}</dd>
            <dt className="text-muted-foreground">
              {tr("jobs.field.profile")}
            </dt>
            <dd>{row.input.profile}</dd>
            {row.subjectType && (
              <>
                <dt className="text-muted-foreground">
                  {tr("jobs.field.subject")}
                </dt>
                <dd>{`${row.subjectType} ${row.subjectId ?? ""}`}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{tr("jobs.field.queued")}</dt>
            <dd>{l(row.queuedAt, { date: "lll" })}</dd>
            {row.endedAt && (
              <>
                <dt className="text-muted-foreground">
                  {tr("jobs.field.ended")}
                </dt>
                <dd>{l(row.endedAt, { date: "lll" })}</dd>
              </>
            )}
            {row.exitCode !== undefined && (
              <>
                <dt className="text-muted-foreground">
                  {tr("jobs.field.exit")}
                </dt>
                <dd>{row.exitCode}</dd>
              </>
            )}
            {row.reason && (
              <>
                <dt className="text-muted-foreground">
                  {tr("jobs.field.reason")}
                </dt>
                <dd className="font-mono text-xs">{row.reason}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{tr("jobs.log")}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            className="bg-muted max-h-[60vh] overflow-auto rounded p-3 font-mono text-xs whitespace-pre-wrap"
            data-testid="job-log"
          >
            {log.stdout || log.stderr
              ? `${log.stdout}${log.stderr ? `\n${log.stderr}` : ""}`
              : tr("jobs.log.empty")}
          </pre>
          {row.logTruncated && (
            <p className="text-muted-foreground mt-2 text-xs">
              {tr("jobs.log.truncated")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectJob;
