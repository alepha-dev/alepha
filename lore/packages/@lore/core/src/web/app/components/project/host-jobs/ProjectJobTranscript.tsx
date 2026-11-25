import { Alert, Button, cn } from "@alepha/ui";
import { AiChatToolTrace } from "@alepha/ui/ai";
import { MarkdownView } from "@alepha/ui/markdown";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef, useState } from "react";

import type { AgentTranscriptResult } from "../../../../../api/schemas/AgentTranscript.ts";
import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import { type I18n } from "../../../services/I18n.ts";

export interface ProjectJobTranscriptProps {
  job: HostJobResource;
  transcript: AgentTranscriptResult;
  /**
   * Whether the job still runs: the transcript follows it.
   */
  live: boolean;
}

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
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      data-testid="job-transcript"
      onScroll={(event) => {
        const el = event.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
      }}
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
            {job.warning && <span className="break-words">{job.warning}</span>}
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
            <MarkdownView content={job.result} />
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
      <section className="flex flex-col gap-3" data-testid="job-events">
        <h2 className="text-muted-foreground text-xs font-medium">
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
              <div key={index} className="text-sm">
                <MarkdownView content={entry.text} />
              </div>
            );
          }
          if (entry.kind === "tools") {
            return (
              <AiChatToolTrace
                key={index}
                defaultOpen
                tools={entry.tools.map((tool) => ({
                  name: tool.name,
                  state: tool.state,
                  ...(tool.detail ? { detail: tool.detail } : {}),
                  input: tool.input,
                  ...(tool.result !== undefined ? { result: tool.result } : {}),
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
          return (
            <pre
              key={index}
              className={cn(
                "text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap",
              )}
              data-testid="job-raw-line"
            >
              {entry.line}
            </pre>
          );
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
  );
};

export default ProjectJobTranscript;
