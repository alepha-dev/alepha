import { Alert } from "@alepha/ui";
import { AiChatToolTrace } from "@alepha/ui/ai";
import { MarkdownView } from "@alepha/ui/markdown";
import type {
  AgentTranscriptResult,
  HostJobPoke,
  HostJobResource,
} from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useMemo, useRef, useState } from "react";

import ProjectJobRawLine from "./ProjectJobRawLine.tsx";

export interface ProjectJobTranscriptProps {
  job: HostJobResource;
  transcript: AgentTranscriptResult;
  /**
   * Whether the job still runs: the transcript follows it.
   */
  live: boolean;
}

/**
 * An entry's prose keeps its own paragraph spacing but loses the margins at
 * its two edges, so the gap between entries is the column's alone and a
 * reply reads as one conversation rather than a log (#Q4416).
 */
const TRIM = "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/**
 * A job read as a conversation (#Q4286), top to bottom: why a failed or
 * timed-out job failed, the agent's final reply, then what it said and did,
 * each run of tool calls drawn with the chat's own `AiChatToolTrace`. The
 * status, the failure and the reply are here, not only in the aside, which
 * a phone does not show.
 */
const ProjectJobTranscript = (props: ProjectJobTranscriptProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { job, transcript } = props;
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const failed = job.status === "failed" || job.status === "timed_out";
  // Each replayed message, by its index, matched in order to the poke that
  // sent it, which names its sender (#Q4456). A poke the host refused never
  // reached the agent, so it names nobody's line.
  const senders = useMemo(() => {
    const out = new Map<number, HostJobPoke>();
    const left = (job.pokes ?? []).filter((poke) => poke.status !== "failed");
    transcript.entries.forEach((entry, index) => {
      if (entry.kind !== "message") return;
      const at = left.findIndex((poke) => poke.message === entry.text);
      if (at < 0) return;
      out.set(index, left[at] as HostJobPoke);
      left.splice(at, 1);
    });
    return out;
  }, [job.pokes, transcript.entries]);
  const lastError = transcript.entries
    .flatMap((it) => (it.kind === "tools" ? it.tools : []))
    .findLast((it) => it.state === "failed");

  // Follows a running job, until the member scrolls up.
  useEffect(() => {
    if (props.live && follow) end.current?.scrollIntoView?.({ block: "end" });
  }, [props.live, follow, transcript.entries.length]);

  return (
    <div
      ref={box}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6"
      data-testid="job-transcript"
      onScroll={(event) => {
        const el = event.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
      }}
    >
      {/* A chat's reading column (#Q4416): the pane scrolls full width, the
          conversation sits centred at a readable measure inside it. */}
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-6"
        data-testid="job-transcript-column"
      >
        {failed && (
          <Alert variant="destructive" data-testid="job-failure">
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                {job.status === "timed_out"
                  ? tr("jobs.transcript.timedOut")
                  : tr("jobs.transcript.failed")}
              </span>
              {job.reason && <span className="break-words">{job.reason}</span>}
              {job.warning && (
                <span className="break-words">{job.warning}</span>
              )}
              {transcript.totals?.error && (
                <span className="break-words">{transcript.totals.error}</span>
              )}
              {lastError?.result && (
                <pre className="font-mono text-xs break-words whitespace-pre-wrap">
                  {lastError.result.slice(0, 2000)}
                </pre>
              )}
            </div>
          </Alert>
        )}
        <section className="flex flex-col gap-1" data-testid="job-reply">
          <h2 className="text-muted-foreground text-xs font-medium">
            {tr("jobs.field.reply")}
          </h2>
          {job.result ? (
            <>
              <MarkdownView content={job.result} className={TRIM} />
              {job.resultTruncated && (
                <p className="text-muted-foreground text-xs">
                  {tr("jobs.field.replyCut")}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {props.live
                ? tr("jobs.transcript.replyLater")
                : tr("jobs.transcript.noReply")}
            </p>
          )}
        </section>
        <section className="flex flex-col gap-4" data-testid="job-events">
          <h2 className="text-muted-foreground mb-1 text-xs font-medium">
            {tr("jobs.transcript.title")}
          </h2>
          {transcript.entries.map((entry, index) => {
            if (entry.kind === "session") {
              return (
                <p
                  key={index}
                  className="text-muted-foreground font-mono text-xs"
                >
                  {[entry.model, entry.cwd].filter(Boolean).join(" · ")}
                </p>
              );
            }
            if (entry.kind === "message") {
              // A member's poke (#Q4456), read by the agent at this point.
              // A user line no poke sent is not a member's: left out.
              const poke = senders.get(index);
              if (!poke) return null;
              return (
                <div
                  key={index}
                  className="bg-muted flex max-w-[85%] flex-col gap-1 self-end rounded-xl px-3 py-2 text-sm [overflow-wrap:anywhere]"
                  data-testid="job-poke-message"
                >
                  <span className="text-muted-foreground text-xs">
                    {tr("jobs.poke.from", {
                      args: [poke.byName ?? tr("jobs.poke.someone")],
                    })}
                  </span>
                  <span className="whitespace-pre-wrap">{entry.text}</span>
                </div>
              );
            }
            if (entry.kind === "text") {
              return (
                // A long unbroken token wraps, and a wide table scrolls, rather
                // than widening the column.
                <div
                  key={index}
                  className="min-w-0 overflow-x-auto text-sm [overflow-wrap:anywhere]"
                >
                  <MarkdownView content={entry.text} className={TRIM} />
                </div>
              );
            }
            if (entry.kind === "tools") {
              return (
                // Folded on load (#Q4308): a transcript opened with every
                // group expanded was a wall of steps. A running call still
                // names itself, with its spinner, on the folded line.
                <AiChatToolTrace
                  key={index}
                  tools={entry.tools.map((tool) => ({
                    name: tool.name,
                    state: tool.state,
                    ...(tool.detail ? { detail: tool.detail } : {}),
                    input: tool.input,
                    ...(tool.result !== undefined
                      ? { result: tool.result }
                      : {}),
                  }))}
                />
              );
            }
            if (entry.kind === "limit") {
              return (
                <p key={index} className="text-warning-text text-xs">
                  {entry.text}
                </p>
              );
            }
            return <ProjectJobRawLine key={index} line={entry.line} />;
          })}
          {/* A running job past its log's cap goes on working (#Q4455): the
              page says so, rather than reading as a job that stopped. */}
          {job.logTruncated && job.status === "running" && (
            <Alert data-testid="job-log-full">
              <span className="text-sm">
                {tr("jobs.transcript.truncatedRunning")}
              </span>
            </Alert>
          )}
          {job.logTruncated && job.status !== "running" && (
            <p className="text-muted-foreground text-xs">
              {tr("jobs.transcript.truncated")}
            </p>
          )}
          <div ref={end} />
        </section>
      </div>
    </div>
  );
};

export default ProjectJobTranscript;
