import { AiChatConfirmCard, type AiChatToolLabel } from "@alepha/ui/ai";
import type { I18n } from "@lore/core/web";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";

import type { ChatMessageResource } from "../../../schemas/index.ts";
import { ChatAgentUiRegistry } from "../services/ChatAgentUiRegistry.ts";
import ChatAgentTrace from "./ChatAgentTrace.tsx";

export interface ChatAgentAnswerProps {
  message: ChatMessageResource;
  me?: string;
  /**
   * Who asked the agent, as the room names them.
   */
  mentioner: string;
  deciding: boolean;
  onDecide: (decision: "approve" | "deny") => void;
  /**
   * Which half to draw: the tool trace, shown above the text, or what
   * follows the text (the thinking line and the card of a paused write).
   */
  part: "trace" | "after";
}

/**
 * The parts of an agent's answer around its text (#E161, #Q3956): the
 * trace of the tools it used, above the text, and the card of a write it
 * waits on, below it.
 *
 * Everyone sees the card; only the member who asked can press it. The
 * server refuses anyone else too: the buttons are a courtesy, not the rule.
 */
const ChatAgentAnswer = (props: ChatAgentAnswerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const registry = useInject(ChatAgentUiRegistry);
  const useToolLabel = registry.toolLabelHook();
  const labelOf = useToolLabel();
  const run = props.message.agentRun;
  if (!run) return null;

  const label: AiChatToolLabel = (name, state) => labelOf(name, state) ?? name;
  const tools = run.tools ?? [];
  const mine = !!props.me && run.mentionerId === props.me;
  const Card = run.tool
    ? (registry.card(run.tool) ?? AiChatConfirmCard)
    : undefined;

  if (props.part === "trace") {
    return <ChatAgentTrace tools={tools} label={label} />;
  }

  return (
    <>
      {run.status === "running" && !props.message.body && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {tr("chat.agent.thinking")}
        </p>
      )}
      {run.status === "paused" && Card && (
        <div className="mt-2 max-w-md" data-testid="chat-agent-card">
          <fieldset disabled={!mine || props.deciding} className="contents">
            <Card
              pending={{
                callId: props.message.id,
                name: run.tool!,
                input: run.input ?? {},
                kind: "confirm",
              }}
              loading={props.deciding}
              onApprove={() => props.onDecide("approve")}
              onDeny={() => props.onDecide("deny")}
            />
          </fieldset>
          {!mine && (
            <p className="text-muted-foreground mt-1 text-xs">
              {tr("chat.agent.waitingFor", { args: [props.mentioner] })}
            </p>
          )}
        </div>
      )}
    </>
  );
};

export default ChatAgentAnswer;
