import { useI18n } from "alepha/react/i18n";
import { SquarePen, Sparkles, X } from "lucide-react";
import { type ComponentType, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "../core/Drawer.tsx";
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
import { type UseAiChatOptions, useAiChat } from "./useAiChat.ts";

export interface AiChatProps extends UseAiChatOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The drawer's title. Defaults to "Assistant".
   */
  title?: string;
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

/**
 * The assistant in a drawer: a quiet header (history menu, new
 * conversation, close), the conversation with its tool steps and a
 * confirmation card for every mutation the assistant wants to run, and a
 * composer that sends on Enter and stops a running turn. It knows the page
 * through `useAiContext()`, and runs `navigate` and `fillForm` for the model.
 *
 * Needs `AlephaApiAi` on the server and a `$ai` declared by the app.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Button onClick={() => setOpen(true)}>Ask</Button>
 * <AiChat
 *   open={open}
 *   onOpenChange={setOpen}
 *   suggestions={[{ label: "Who still owes today?" }]}
 * />
 * ```
 */
export const AiChat = (props: AiChatProps) => {
  const { tr } = useI18n();
  const chat = useAiChat(props);
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

  return (
    <Drawer
      open={props.open}
      onOpenChange={(open) => props.onOpenChange(open)}
      swipeDirection="right"
    >
      <DrawerContent
        data-testid="ai-chat"
        // From `sm` up the panel floats: a gap from the page's edges, every
        // corner rounded, a shadow, and no bleed strip past its edge.
        className="flex h-full w-full flex-col gap-0 p-0 sm:h-[calc(100dvh-1.5rem)] sm:max-w-md sm:[--drawer-inset:0.75rem] sm:after:hidden sm:data-[swipe-direction=right]:rounded-2xl sm:data-[swipe-direction=right]:border sm:data-[swipe-direction=right]:shadow-2xl"
      >
        <div className="border-border flex items-center gap-2 border-b py-2.5 pr-2.5 pl-4">
          <Sparkles className="text-primary size-4 shrink-0" />
          <DrawerTitle className="flex-1 truncate text-base font-medium">
            {props.title ?? tr("ai.chat.title", { default: "Assistant" })}
          </DrawerTitle>
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
          <DrawerClose
            render={
              <Button
                size="icon-sm"
                variant="minimal"
                aria-label={tr("ai.chat.close", { default: "Close" })}
              />
            }
          >
            <X className="size-4" />
          </DrawerClose>
        </div>
        <div
          ref={thread}
          // `shrink-0` on every line: in a scrolling column a card (overflow
          // hidden, so no content minimum) would shrink to its border once
          // the thread outgrows the drawer (#Q3174).
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
              {chat.items.map((item) => (
                <AiChatMessage
                  key={item.id}
                  item={item}
                  renderLink={props.renderLink}
                  toolLabel={props.toolLabel}
                />
              ))}
              {chat.streaming && (
                <div
                  data-testid="ai-chat-streaming"
                  className="mr-4 self-start text-sm leading-relaxed"
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
      </DrawerContent>
    </Drawer>
  );
};
