import { useI18n } from "alepha/react/i18n";
import { ArrowUp, Square } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { Button } from "../core/Button.tsx";
import { cn } from "../core/utils.ts";

export interface AiChatComposerProps {
  /**
   * A turn is running: the send button becomes Stop.
   */
  busy?: boolean;
  /**
   * A confirmation card waits for the user: nothing can be sent until it is
   * answered, and the field says so.
   */
  waiting?: boolean;
  onSend: (message: string) => void;
  onStop?: () => void;
}

/**
 * Where the user writes to the assistant: a field that grows with what is
 * typed, Enter to send, Shift+Enter for a new line, and one round button
 * that sends, or stops the turn while it runs.
 *
 * What is typed lives here, so a re-render of the drawer never drops it.
 */
export const AiChatComposer = (props: AiChatComposerProps) => {
  const { tr } = useI18n();
  const [value, setValue] = useState("");
  const blocked = Boolean(props.waiting);
  const canSend = !props.busy && !blocked && value.trim().length > 0;

  const send = () => {
    if (!canSend) {
      return;
    }
    const message = value.trim();
    setValue("");
    props.onSend(message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      data-testid="ai-chat-composer"
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div
        className={cn(
          "border-border bg-background focus-within:border-ring focus-within:ring-ring/40 flex items-end gap-2 rounded-2xl border py-2 pr-2 pl-3 transition-shadow focus-within:ring-3",
          blocked && "bg-muted/50",
        )}
      >
        <textarea
          aria-label={tr("ai.chat.message", { default: "Message" })}
          rows={1}
          value={value}
          disabled={blocked}
          placeholder={
            blocked
              ? tr("ai.chat.waiting", {
                  default: "Confirm or cancel the card to go on",
                })
              : tr("ai.chat.placeholder", { default: "Ask the assistant" })
          }
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          className="placeholder:text-muted-foreground field-sizing-content max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed outline-none disabled:cursor-not-allowed"
        />
        {props.busy ? (
          <Button
            type="button"
            size="icon-sm"
            variant="outlined"
            className="shrink-0 rounded-full"
            aria-label={tr("ai.chat.stop", { default: "Stop" })}
            onClick={() => props.onStop?.()}
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            intent="primary"
            className="shrink-0 rounded-full"
            disabled={!canSend}
            aria-label={tr("ai.chat.send", { default: "Send" })}
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      <p className="text-muted-foreground px-1 text-[11px]">
        {tr("ai.chat.hint", {
          default: "Enter to send, Shift+Enter for a new line",
        })}
      </p>
    </form>
  );
};
