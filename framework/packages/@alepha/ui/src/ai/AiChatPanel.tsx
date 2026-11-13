import { useI18n } from "alepha/react/i18n";
import { Minus, SquarePen, Sparkles, X } from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import { Spinner } from "../core/Spinner.tsx";
import {
  type MarkdownLinkRenderer,
  MarkdownView,
} from "../markdown/MarkdownView.tsx";
import { AiChatComposer } from "./AiChatComposer.tsx";
import {
  AiChatConfirmCard,
  type AiChatConfirmCardProps,
} from "./AiChatConfirmCard.tsx";
import { AiChatEmpty, type AiChatSuggestion } from "./AiChatEmpty.tsx";
import { AiChatHistory } from "./AiChatHistory.tsx";
import { AiChatMessage, type AiChatToolLabel } from "./AiChatMessage.tsx";
import type { UseAiChat } from "./useAiChat.ts";

/**
 * What the conversation looks like, whatever holds it: the props `AiChat`
 * passes through to its panel.
 */
export interface AiChatViewProps {
  /**
   * The panel's title. Defaults to "Assistant".
   */
  title?: string;
  /**
   * The app's own controls in the panel's header, before the history menu:
   * a link to the assistant's help page, say.
   */
  headerActions?: ReactNode;
  /**
   * Offer the list of past conversations, in a header menu. Default true.
   */
  history?: boolean;
  /**
   * Questions a new conversation offers to start from.
   */
  suggestions?: AiChatSuggestion[];
  /**
   * Names each tool step in the user's words ("Searched clients"), running
   * and done. Without it a step shows the tool's own name.
   */
  toolLabel?: AiChatToolLabel;
  /**
   * A confirmation card per tool name, in place of the generic field list:
   * an app shows a booking as a booking. It gets the pending call as the
   * server stored it, and the approve and deny callbacks.
   */
  confirmCards?: Record<string, ComponentType<AiChatConfirmCardProps>>;
  /**
   * How links in the assistant's replies render (`MarkdownView`'s
   * `renderLink`): route the paths the app knows, leave the rest as text.
   */
  renderLink?: MarkdownLinkRenderer;
}

export interface AiChatPanelProps extends AiChatViewProps {
  /**
   * The conversation to show, from `useAiChat()`.
   */
  chat: UseAiChat;
  onClose: () => void;
  /**
   * Fold the panel away without ending the conversation. Without it the
   * header has no minimize button.
   */
  onMinimize?: () => void;
  /**
   * Renders the title, so a shell can give it its own element (a drawer
   * names its dialog with it). Defaults to a heading.
   */
  renderTitle?: (title: string, className: string) => ReactNode;
}

/**
 * The conversation itself, with no container: a quiet header (history menu,
 * new conversation, minimize, close), the thread with its tool steps and a
 * confirmation card for every mutation the assistant wants to run, and the
 * composer. `AiChat` puts it in a drawer or in a dock; an app with its own
 * container renders it there, with the `useAiChat()` it owns.
 */
export const AiChatPanel = (props: AiChatPanelProps) => {
  const { tr } = useI18n();
  const { chat } = props;
  const thread = useRef<HTMLDivElement>(null);
  const busy = chat.loading && !chat.pending;
  const empty = chat.items.length === 0 && !chat.streaming && !busy;

  // Keep the newest line in view as the conversation grows.
  useEffect(() => {
    const node = thread.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [chat.items.length, chat.streaming, chat.activity, chat.pending]);

  const running = chat.activity
    ? (props.toolLabel?.(chat.activity, "running") ??
      tr("ai.chat.running", {
        default: "Running $1",
        args: [chat.activity],
      }))
    : undefined;

  const Card = chat.pending
    ? (props.confirmCards?.[chat.pending.name] ?? AiChatConfirmCard)
    : undefined;

  const title = props.title ?? tr("ai.chat.title", { default: "Assistant" });
  const titleClassName = "flex-1 truncate text-base font-medium";

  return (
    <div data-testid="ai-chat" className="flex h-full min-h-0 w-full flex-col">
      {/* `h-14`, the height of `AppShell`'s header: docked beside a page, the
          two headers' bottom lines continue each other (#Q3584). */}
      <div className="border-border flex h-14 shrink-0 items-center gap-2 border-b ps-4 pe-2.5">
        <Sparkles className="text-primary size-4 shrink-0" />
        {props.renderTitle ? (
          props.renderTitle(title, titleClassName)
        ) : (
          <h2 className={titleClassName}>{title}</h2>
        )}
        {props.headerActions}
        {props.history !== false && (
          <AiChatHistory
            current={chat.conversationId}
            disabled={chat.loading}
            onOpen={(id) => chat.open(id)}
          />
        )}
        <Button
          size="icon-sm"
          variant="minimal"
          disabled={chat.loading || empty}
          aria-label={tr("ai.chat.new", { default: "New conversation" })}
          onClick={() => chat.open(undefined)}
        >
          <SquarePen className="size-4" />
        </Button>
        {props.onMinimize && (
          <Button
            size="icon-sm"
            variant="minimal"
            aria-label={tr("ai.chat.minimize", { default: "Minimize" })}
            onClick={props.onMinimize}
          >
            <Minus className="size-4" />
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="minimal"
          aria-label={tr("ai.chat.close", { default: "Close" })}
          onClick={props.onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div
        ref={thread}
        // `shrink-0` on every line: in a scrolling column a card (overflow
        // hidden, so no content minimum) would shrink to its border once
        // the thread outgrows the panel (#Q3174).
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 *:shrink-0"
      >
        {empty ? (
          <AiChatEmpty
            suggestions={props.suggestions}
            disabled={chat.loading}
            onPick={(prompt) => chat.send(prompt)}
          />
        ) : (
          <>
            {chat.items.map((item, index) => (
              <AiChatMessage
                key={item.id}
                item={item}
                renderLink={props.renderLink}
                toolLabel={props.toolLabel}
                // Only where continuing still means "this answer": the last
                // line, with no turn running and no card waiting.
                onContinue={
                  item.cut &&
                  index === chat.items.length - 1 &&
                  !chat.loading &&
                  !chat.pending
                    ? () =>
                        void chat.send(
                          tr("ai.chat.continueMessage", {
                            default: "Continue",
                          }),
                        )
                    : undefined
                }
              />
            ))}
            {chat.streaming && (
              <div
                data-testid="ai-chat-streaming"
                className="me-4 self-start text-sm leading-relaxed"
              >
                <MarkdownView
                  content={chat.streaming}
                  renderLink={props.renderLink}
                />
              </div>
            )}
            {running && (
              <div className="text-muted-foreground flex items-center gap-1.5 px-0.5 text-xs">
                <Spinner className="size-3.5" />
                {running}
              </div>
            )}
            {busy && !running && !chat.streaming && (
              <div
                className="text-muted-foreground flex items-center gap-1.5 px-0.5 text-xs"
                aria-live="polite"
              >
                <Spinner className="size-3.5" />
                {tr("ai.chat.thinking", { default: "Thinking…" })}
              </div>
            )}
            {chat.pending?.kind === "confirm" && Card && (
              <Card
                pending={chat.pending}
                loading={chat.loading}
                onApprove={() => chat.approve()}
                onDeny={() => chat.deny()}
              />
            )}
          </>
        )}
        {chat.error && (
          <Alert variant="destructive" data-testid="ai-chat-error">
            <AlertDescription>{chat.error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="border-border border-t px-3 pt-3 pb-2.5">
        <AiChatComposer
          busy={busy}
          waiting={chat.pending?.kind === "confirm"}
          onSend={(message) => chat.send(message)}
          onStop={() => chat.stop()}
        />
      </div>
    </div>
  );
};
