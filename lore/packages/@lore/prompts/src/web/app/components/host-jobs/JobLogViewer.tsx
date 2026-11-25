import { Button, cn } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowDown, Loader2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export interface JobLogViewerProps {
  stdout: string;
  stderr: string;
  /**
   * The job may still print: the viewer follows the output and shows it is
   * waiting.
   */
  live: boolean;
  truncated?: boolean;
}

/**
 * How close to the bottom, in pixels, still counts as following.
 */
const FOLLOW_SLACK = 24;

/**
 * A job's log as a terminal reads (#Q4207): one numbered line per line,
 * stderr marked, monospaced, scrolling in its own pane. While the job runs
 * it follows the output, as `tail -f` does, until the reader scrolls up;
 * "Follow output" takes them back to the end.
 */
const JobLogViewer = (props: JobLogViewerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const lines = [
    ...split(props.stdout).map((text) => ({ text, stderr: false })),
    ...split(props.stderr).map((text) => ({ text, stderr: true })),
  ];

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && follow) node.scrollTop = node.scrollHeight;
  }, [props.stdout, props.stderr, follow]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    setFollow(
      node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_SLACK,
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="bg-card min-h-0 flex-1 overflow-auto py-2 font-mono text-xs leading-5"
        data-testid="job-log"
        data-following={follow ? "true" : "false"}
        role="log"
        aria-label={tr("jobs.log")}
        aria-live={props.live ? "polite" : "off"}
      >
        {lines.length === 0 ? (
          <p
            className="text-muted-foreground flex items-center gap-2 px-4 font-sans"
            data-testid="job-log-empty"
          >
            {props.live && (
              <Loader2
                className="size-3.5 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {props.live ? tr("jobs.log.waiting") : tr("jobs.log.empty")}
          </p>
        ) : (
          <ol className="min-w-max">
            {lines.map((line, index) => (
              <li
                // Lines only ever append: the index is the line's identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only
                key={index}
                className={cn(
                  "hover:bg-hover-weak flex gap-4 pe-4",
                  line.stderr && "bg-danger/10 text-danger",
                )}
                data-stream={line.stderr ? "stderr" : "stdout"}
              >
                <span
                  className="text-muted-foreground w-12 shrink-0 text-end select-none"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="whitespace-pre">{line.text}</span>
              </li>
            ))}
            {props.live && (
              <li className="flex gap-4 pe-4" data-testid="job-log-cursor">
                <span className="w-12 shrink-0" />
                <span
                  className="bg-foreground/70 mt-1 inline-block h-3 w-1.5 motion-safe:animate-pulse"
                  aria-hidden="true"
                />
              </li>
            )}
          </ol>
        )}
      </div>
      {props.truncated && (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          {tr("jobs.log.truncated")}
        </p>
      )}
      {props.live && !follow && lines.length > 0 && (
        <Button
          variant="outlined"
          size="sm"
          className="absolute end-4 bottom-4 shadow-md"
          onClick={() => setFollow(true)}
          data-testid="job-log-follow"
        >
          <ArrowDown className="size-3.5" />
          {tr("jobs.log.follow")}
        </Button>
      )}
    </div>
  );
};

/**
 * A stream's lines, without the empty one a trailing newline leaves.
 */
const split = (text: string): string[] => {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

export default JobLogViewer;
