import type { HostJobController } from "@lore/core/api";
import { AgentTranscript } from "@lore/core/schemas";
import { useClient, useQuery } from "alepha/react";
import { useId, useMemo, useRef, useState } from "react";

import { jobInFlight } from "./jobStatusIcon.ts";

/**
 * One job as a page reads it (#Q4515): its row every 3 s and its log by byte
 * offsets every 2 s, each asking only for what lies past what is held, until
 * the job ends; neither in a hidden tab. The job page and the side panel are two views of this one
 * reader, never two implementations. Off (`enabled: false`), nothing is
 * read: the side panel closed.
 */
export const useJobReader = (
  jobId: string | undefined,
  options: { enabled?: boolean } = {},
) => {
  const api = useClient<HostJobController>();
  const enabled = (options.enabled ?? true) && !!jobId;
  // Keyed by the job it holds, so moving to another job starts it empty.
  const [held, setLog] = useState({ jobId, stdout: "", stderr: "" });
  const log = held.jobId === jobId ? held : { stdout: "", stderr: "" };
  // Keyed by its job too: a job just opened is live until its log says not.
  const [liveOf, setLiveOf] = useState({ jobId, live: true });
  // How far the held log goes: a reader turned off and on again (the panel
  // closed and reopened on the same job) resumes there rather than
  // appending the whole log a second time.
  const read = useRef<{
    jobId?: string;
    next: { stdout: number; stderr: number };
  }>({ next: { stdout: 0, stderr: 0 } });
  const live = liveOf.jobId === jobId ? liveOf.live : true;

  const job = useQuery(
    {
      enabled,
      key: ["host-job", jobId],
      keepPreviousData: true,
      runEvery: enabled && live ? 3000 : undefined,
      handler: async () => api.getJob({ params: { jobId: jobId as string } }),
    },
    [jobId, live, enabled],
  );

  // The log, read through `useQuery` like every poll (#Q3860): each read
  // asks for what lies past the bytes held, every 2 s while the job is live,
  // never in a hidden tab (`runEvery`), and a failed read is retried at the
  // next tick rather than ending the poll. Keyed per reader (and on), so a
  // reader that comes back resumes at once from what it holds.
  const reader = useId();
  useQuery(
    {
      enabled,
      key: ["host-job-log", jobId, reader, enabled],
      runEvery: enabled && live ? 2000 : undefined,
      handler: async () => {
        const id = jobId as string;
        const from =
          read.current.jobId === id
            ? read.current.next
            : { stdout: 0, stderr: 0 };
        const part = await api.getJobLog({
          params: { jobId: id },
          query: from,
        });
        read.current = { jobId: id, next: part.next };
        if (part.stdout || part.stderr) {
          setLog((current) =>
            current.jobId === id
              ? {
                  jobId: id,
                  stdout: current.stdout + part.stdout,
                  stderr: current.stderr + part.stderr,
                }
              : { jobId: id, stdout: part.stdout, stderr: part.stderr },
          );
        }
        setLiveOf({ jobId: id, live: part.live });
        return part.next;
      },
      onError: () => {},
    },
    [api, jobId, enabled, live],
  );

  const row = job.data?.id === jobId ? job.data : undefined;
  const transcript = useMemo(
    () => AgentTranscript.parse(log.stdout, row?.input.agent),
    [log.stdout, row?.input.agent],
  );
  const inFlight = row ? jobInFlight(row.status) : true;

  return { job, row, log, live, transcript, inFlight };
};
