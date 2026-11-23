import { useI18n } from "alepha/react/i18n";
import { Ban, Check, ChevronRight, Wrench, X } from "lucide-react";
import { useId, useState } from "react";

import { Spinner } from "../core/Spinner.tsx";
import { cn } from "../core/utils.ts";
import type { AiChatToolLabel } from "./AiChatMessage.tsx";

export interface AiChatToolTraceProps {
  /**
   * The calls of one run of tools, in order. A `running` one is the call in
   * flight: while there is one, the line names it alone.
   */
  tools: ReadonlyArray<AiChatToolStep>;
  /**
   * The words of one step, as `AiChat`'s `toolLabel`.
   */
  label?: AiChatToolLabel;
  /**
   * The words of the folded line once nothing runs, such as "Read 2 quests,
   * 1 folio". Return undefined to keep the default.
   */
  summary?: AiChatToolSummary;
}

/**
 * One tool call of a run, as the trace shows it.
 */
export interface AiChatToolStep {
  name: string;
  state: "running" | "done" | "failed" | "denied";
}

/**
 * The folded line of a run of tool calls: `AiChat`'s `toolSummary`.
 */
export type AiChatToolSummary = (
  tools: ReadonlyArray<AiChatToolStep>,
) => string | undefined;

/**
 * A run of tool calls as one line that opens on every step: "Used 4 tools",
 * or the app's own summary. While a call runs, the line names that call
 * only, with a spinner. The AI chat and Lore's chat rooms both draw their
 * tool calls with it.
 */
export const AiChatToolTrace = (props: AiChatToolTraceProps) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (props.tools.length === 0) {
    return null;
  }

  const labelOf = (step: AiChatToolStep) =>
    props.label?.(step.name, step.state) ??
    (step.state === "running"
      ? tr("ai.chat.running", { default: "Running $1", args: [step.name] })
      : step.state === "denied"
        ? tr("ai.chat.toolDenied", {
            default: "$1 cancelled",
            args: [step.name],
          })
        : step.state === "failed"
          ? tr("ai.chat.toolFailed", {
              default: "$1 failed",
              args: [step.name],
            })
          : tr("ai.chat.toolDone", { default: "Ran $1", args: [step.name] }));

  const running = props.tools.findLast((step) => step.state === "running");
  const failed = props.tools.some((step) => step.state === "failed");
  const line = running
    ? labelOf(running)
    : (props.summary?.(props.tools) ??
      (props.tools.length === 1
        ? labelOf(props.tools[0])
        : tr("ai.chat.toolsUsed", {
            default: "Used $1 tools",
            args: [String(props.tools.length)],
          })));

  return (
    <div data-testid="ai-chat-tool-trace" className="px-0.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded text-start text-xs",
          failed && !running && "text-danger-text",
        )}
      >
        {running ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <Wrench className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span data-testid="ai-chat-tool-trace-line">{line}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform rtl:-scale-x-100",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol
          id={listId}
          data-testid="ai-chat-tool-trace-steps"
          className="text-muted-foreground ms-1.5 mt-1 mb-1 flex flex-col gap-0.5 border-s ps-3 text-xs"
        >
          {props.tools.map((step, index) => (
            <li
              key={`${step.name}-${index}`}
              data-testid="ai-chat-tool"
              className={cn(
                "flex items-center gap-1.5",
                step.state === "failed" && "text-danger-text",
              )}
            >
              {step.state === "running" ? (
                <Spinner className="size-3 shrink-0" />
              ) : step.state === "denied" ? (
                <Ban className="size-3 shrink-0" aria-hidden="true" />
              ) : step.state === "failed" ? (
                <X className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <Check
                  className="text-success-text size-3 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>{labelOf(step)}</span>
              <code className="bg-muted rounded px-1 font-mono text-[10px]">
                {step.name}
              </code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
