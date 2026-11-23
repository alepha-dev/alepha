import { Button, cn, useToast } from "@alepha/ui";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";
import { StackTraceParser } from "../../services/StackTraceParser.ts";

export interface StackTraceViewerProps {
  /**
   * The stack as reported: frames, then any `Caused by:` lines.
   */
  stack: string;
  /**
   * The error's own name and message, for a stack that does not start with
   * its header (a browser's often does not).
   */
  name?: string;
  message?: string;
  className?: string;
}

/**
 * A stack trace, read (#Q4186): one section per error of the chain, each
 * `Caused by:` nested under the one it explains, frames one per line with
 * the function, the file and the line:column told apart by colour, and
 * frames from dependencies or minified bundles dimmed. A copy button takes
 * the stack as reported.
 *
 * ⚠️ SECURITY: a stack is attacker-controlled. Every part is rendered as
 * plain React text: never Markdown, never HTML.
 */
const StackTraceViewer = (props: StackTraceViewerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toast = useToast();
  const parser = useInject(StackTraceParser);
  const chain = parser.parse(props.stack, {
    name: props.name,
    message: props.message,
  });

  const copy = async () => {
    // The toast only after the write resolved: the clipboard call rejects
    // on an insecure context.
    try {
      await navigator.clipboard.writeText(props.stack);
      toast.success(tr("stackTrace.copied"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className={cn("relative flex min-w-0 flex-col gap-2", props.className)}
      data-testid="stack-trace"
    >
      <Button
        variant="outlined"
        size="sm"
        className="absolute end-2 top-2 z-10"
        onClick={() => void copy()}
        aria-label={tr("stackTrace.copy")}
      >
        <Copy />
        {tr("stackTrace.copy")}
      </Button>
      {chain.map((error, depth) => (
        <section
          // A chain does not reorder: its position is its identity.
          key={depth}
          className={cn(
            "bg-card min-w-0 rounded-md border",
            depth > 0 && "border-s-danger-text/60 border-s-2",
          )}
          style={
            depth > 0
              ? { marginInlineStart: `${Math.min(depth, 4) * 0.75}rem` }
              : undefined
          }
          data-testid="stack-trace-error"
        >
          <header className="chrome border-b px-3 py-2 pe-28">
            {depth > 0 && (
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {tr("stackTrace.causedBy")}
              </p>
            )}
            <p className="font-mono text-xs break-words whitespace-pre-wrap select-text">
              {error.name && (
                <span className="text-danger-text font-semibold">
                  {error.name}
                </span>
              )}
              {error.name && error.message && ": "}
              <span className="text-foreground">{error.message}</span>
            </p>
          </header>
          {error.frames.length > 0 && (
            <ol className="flex flex-col py-1.5 font-mono text-xs">
              {error.frames.map((frame, index) => (
                <li
                  key={index}
                  className={cn(
                    "px-3 py-0.5 break-all",
                    frame.external && "opacity-55",
                  )}
                  data-external={frame.external || undefined}
                >
                  <span className="text-muted-foreground">at </span>
                  {frame.file === undefined ? (
                    <span className="text-muted-foreground">{frame.raw}</span>
                  ) : (
                    <>
                      {frame.fn && (
                        <span className="text-primary-text font-medium">
                          {frame.fn}{" "}
                        </span>
                      )}
                      <span className="text-foreground">{frame.file}</span>
                      {frame.line !== undefined && (
                        <span className="text-warning-text">
                          :{frame.line}
                          {frame.column !== undefined && `:${frame.column}`}
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
};

export default StackTraceViewer;
