import { Button, Textarea } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowUp } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import type { ChatRoomResource } from "../../../schemas/index.ts";

export interface ChatComposerProps {
  room: ChatRoomResource;
  /**
   * Resolves `true` when the message was sent, and the composer empties.
   */
  onSend: (body: string) => Promise<boolean>;
}

/**
 * The Chat page's composer (#E161, #Q3929): a multi-line input where Enter
 * sends and Shift+Enter breaks the line. The text stays when a send fails.
 */
const ChatComposer = (props: ChatComposerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    const sent = await props.onSend(body);
    setBusy(false);
    if (sent) setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="flex items-end gap-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Textarea
        data-testid="chat-composer"
        aria-label={tr("chat.composer.label")}
        placeholder={tr("chat.composer.placeholder", {
          args: [props.room.name],
        })}
        value={value}
        rows={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-48 min-h-9 resize-none"
      />
      <Button
        type="submit"
        size="icon"
        aria-label={tr("chat.composer.send")}
        disabled={busy || value.trim().length === 0}
      >
        <ArrowUp className="size-4" />
      </Button>
    </form>
  );
};

export default ChatComposer;
