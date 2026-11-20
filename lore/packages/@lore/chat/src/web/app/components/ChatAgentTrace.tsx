import { cn } from "@alepha/ui";
import type { AiChatToolLabel } from "@alepha/ui/ai";
import type { I18n } from "@lore/core/web";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, ChevronRight, Loader2, Wrench, X } from "lucide-react";
import { useId, useState } from "react";

import { ToolTrace, type ToolKind } from "../services/toolTrace.ts";

export interface ChatAgentTraceProps {
  tools: ReadonlyArray<{ name: string; state: "running" | "done" | "failed" }>;
  label: AiChatToolLabel;
}

// Spelled out, so the i18n check finds every key it reads.
const KIND_LABELS = {
  quest: {
    one: "chat.agent.trace.quest.one",
    other: "chat.agent.trace.quest.other",
  },
  epic: {
    one: "chat.agent.trace.epic.one",
    other: "chat.agent.trace.epic.other",
  },
  folio: {
    one: "chat.agent.trace.folio.one",
    other: "chat.agent.trace.folio.other",
  },
  release: {
    one: "chat.agent.trace.release.one",
    other: "chat.agent.trace.release.other",
  },
  feedback: {
    one: "chat.agent.trace.feedback.one",
    other: "chat.agent.trace.feedback.other",
  },
  project: {
    one: "chat.agent.trace.project",
    other: "chat.agent.trace.project",
  },
  search: {
    one: "chat.agent.trace.search.one",
    other: "chat.agent.trace.search.other",
  },
  other: {
    one: "chat.agent.trace.other.one",
    other: "chat.agent.trace.other.other",
  },
} as const;

/**
 * The line over an agent's answer saying what it used (#E161): one summary,
 * "Read 6 quests, 1 folio", that opens on every step it took. While a tool
 * runs, the line names that tool instead.
 */
const ChatAgentTrace = (props: ChatAgentTraceProps) => {
  const { tr } = useI18n<I18n, "en">();
  const trace = useInject(ToolTrace);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (props.tools.length === 0) return null;

  const running = props.tools.findLast((tool) => tool.state === "running");
  const counted = (items: Array<{ kind: ToolKind; count: number }>) =>
    items
      .map(({ kind, count }) =>
        tr(KIND_LABELS[kind][count === 1 ? "one" : "other"], {
          args: [String(count)],
        }),
      )
      .join(", ");
  const { read, changed } = trace.summarize(props.tools);
  const summary = running
    ? props.label(running.name, "running")
    : read.length && changed.length
      ? tr("chat.agent.trace.readAndChanged", {
          args: [counted(read), counted(changed)],
        })
      : changed.length
        ? tr("chat.agent.trace.changed", { args: [counted(changed)] })
        : read.length
          ? tr("chat.agent.trace.read", { args: [counted(read)] })
          : tr("chat.agent.trace.failed");

  return (
    <div className="mt-px mb-0.5" data-testid="chat-agent-trace">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded text-xs"
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Wrench className="size-3.5" aria-hidden="true" />
        )}
        <span>{summary}</span>
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol
          id={listId}
          className="text-muted-foreground mt-1 mb-1 ml-1.5 flex flex-col gap-0.5 border-l pl-3 text-xs"
          data-testid="chat-agent-trace-steps"
        >
          {props.tools.map((tool, index) => (
            <li
              key={`${tool.name}-${index}`}
              className="flex items-center gap-1.5"
            >
              {tool.state === "running" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : tool.state === "done" ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <X className="text-danger-text size-3" aria-hidden="true" />
              )}
              <span>{props.label(tool.name, tool.state)}</span>
              <code className="bg-muted rounded px-1 font-mono text-[10px]">
                {tool.name}
              </code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default ChatAgentTrace;
