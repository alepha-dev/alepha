import {
  type AiChatToolLabel,
  type AiChatToolStep,
  AiChatToolTrace,
} from "@alepha/ui/ai";

import { useChatToolSummary } from "../hooks/useChatToolSummary.ts";

export interface ChatAgentTraceProps {
  tools: ReadonlyArray<AiChatToolStep>;
  label: AiChatToolLabel;
}

/**
 * The line over an agent's answer saying what it used (#E161): one summary,
 * "Read 6 quests, 1 folio", that opens on every step it took. While a tool
 * runs, the line names that tool instead. Drawn by `@alepha/ui`'s
 * `AiChatToolTrace`, as the assistant panel's runs are (#Q4212).
 */
const ChatAgentTrace = (props: ChatAgentTraceProps) => {
  const summary = useChatToolSummary();
  if (props.tools.length === 0) return null;
  return (
    <div className="mt-px mb-0.5" data-testid="chat-agent-trace">
      <AiChatToolTrace
        tools={props.tools}
        label={props.label}
        summary={summary}
      />
    </div>
  );
};

export default ChatAgentTrace;
