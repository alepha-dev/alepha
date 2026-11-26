import { Alert, Button } from "@alepha/ui";
import { AiChatToolTrace } from "@alepha/ui/ai";
import { MarkdownView } from "@alepha/ui/markdown";
import type {
  AgentTranscriptResult,
  HostJobResource,
} from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef, useState } from "react";

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
  const [showHidden, setShowHidden] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const failed = job.status === "failed" || job.status === "timed_out";
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
          {transcript.hidden > 0 && (
            <Button
              variant="minimal"
              size="sm"
              className="self-start"
              onClick={() => setShowHidden((it) => !it)}
            >
              {tr("jobs.transcript.hidden", {
                args: [String(transcript.hidden)],
              })}
            </Button>
          )}
          {showHidden && (
            <p className="text-muted-foreground text-xs">
              {tr("jobs.transcript.hiddenHint")}
            </p>
          )}
          {job.logTruncated && (
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
