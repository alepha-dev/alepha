import { cn } from "../core/utils.ts";
import type { AiChatToolStep } from "./AiChatToolTrace.tsx";

export interface AiChatToolStepDetailsProps {
  step: AiChatToolStep;
  /**
   * The step's words, shown when it has no `detail`.
   */
  label: string;
}

/**
 * A step that carries its input and result: its line opens on them, the
 * result folded under it and marked when the call failed.
 */
export const AiChatToolStepDetails = (props: AiChatToolStepDetailsProps) => (
  <details className="min-w-0 flex-1" data-testid="ai-chat-tool-details">
    <summary className="flex cursor-pointer items-center gap-1.5">
      <code className="bg-muted rounded px-1 font-mono text-[10px]">
        {props.step.name}
      </code>
      <span className="min-w-0 truncate">
        {props.step.detail ?? props.label}
      </span>
    </summary>
    {props.step.input !== undefined && (
      <pre className="bg-muted mt-1 max-h-64 overflow-auto rounded p-2 font-mono text-[11px] break-words whitespace-pre-wrap">
        {props.step.input}
      </pre>
    )}
    {props.step.result !== undefined && (
      <pre
        className={cn(
          "bg-muted mt-1 max-h-64 overflow-auto rounded p-2 font-mono text-[11px] break-words whitespace-pre-wrap",
          props.step.state === "failed" && "text-danger-text",
        )}
      >
        {props.step.result}
      </pre>
    )}
  </details>
);
