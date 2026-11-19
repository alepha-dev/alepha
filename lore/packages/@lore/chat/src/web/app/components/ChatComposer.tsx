import { Button, cn, Textarea } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowUp, Bot } from "lucide-react";
import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { ChatRoomResource } from "../../../schemas/index.ts";

/**
 * Who the `@` popup offers: a member who can see the room, or an agent.
 */
export interface ChatMentionCandidate {
  /**
   * What is inserted after the `@`, and what the server resolves.
   */
  handle: string;
  /**
   * The display name shown beside the handle.
   */
  label: string;
  agent?: boolean;
}

export interface ChatComposerProps {
  room: ChatRoomResource;
  candidates: ChatMentionCandidate[];
  /**
   * Resolves `true` when the message was sent, and the composer empties.
   */
  onSend: (body: string) => Promise<boolean>;
}

/**
 * The most the popup lists at once: typing narrows it.
 */
const MAX_OPTIONS = 8;

/**
 * The Chat page's composer (#E161, #Q3929, #Q3937): a multi-line input where
 * Enter sends and Shift+Enter breaks the line, and `@` opens the members
 * who can see the room, agents first.
 *
 * The input is the popup's combobox: arrows move the active option, Enter or
 * Tab inserts it, Escape closes. A screen reader follows the active option
 * through `aria-activedescendant`, so focus never leaves the text.
 */
const ChatComposer = (props: ChatComposerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const listId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const caretAfter = useRef<number | undefined>(undefined);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<
    { start: number; query: string } | undefined
  >(undefined);
  const [active, setActive] = useState(0);

  const options = mention
    ? props.candidates
        .filter((candidate) => {
          const query = mention.query.toLowerCase();
          // The handle, or any word of the name, starts with what is typed.
          return [candidate.handle, ...candidate.label.split(/\s+/)].some(
            (word) => word.toLowerCase().startsWith(query),
          );
        })
        .sort((a, b) => Number(!!b.agent) - Number(!!a.agent))
        .slice(0, MAX_OPTIONS)
    : [];
  const open = options.length > 0;

  // Put the caret after an inserted mention, once React has written it.
  useLayoutEffect(() => {
    const at = caretAfter.current;
    if (at === undefined || !input.current) return;
    caretAfter.current = undefined;
    input.current.setSelectionRange(at, at);
  }, [value]);

  /**
   * The `@word` the caret is in, if any.
   */
  const track = (text: string, caret: number) => {
    const match = /(^|[\s(])@([\w.-]*)$/.exec(text.slice(0, caret));
    if (!match) {
      setMention(undefined);
      return;
    }
    const query = match[2] ?? "";
    setMention({ start: caret - query.length - 1, query });
    setActive(0);
  };

  const pick = (candidate: ChatMentionCandidate) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const inserted = `@${candidate.handle} `;
    setValue(value.slice(0, mention.start) + inserted + value.slice(end));
    caretAfter.current = mention.start + inserted.length;
    setMention(undefined);
  };

  const send = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    const sent = await props.onSend(body);
    setBusy(false);
    if (sent) setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[active] ?? options[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(undefined);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <form
      className="relative flex items-end gap-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={tr("chat.composer.mentions")}
          data-testid="chat-mention-popup"
          className="bg-popover text-popover-foreground absolute bottom-full left-3 mb-1 w-72 overflow-hidden rounded-md border p-1 shadow-md"
        >
          {options.map((candidate, index) => (
            <div
              key={candidate.handle}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              data-handle={candidate.handle}
              aria-selected={index === active}
              // Picked on mouse down, before the input loses focus. The
              // keyboard path is the input's: the options are never focused.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(candidate);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              {candidate.agent && <Bot className="size-3.5 shrink-0" />}
              <span className="font-medium">@{candidate.handle}</span>
              <span className="text-muted-foreground truncate text-xs">
                {candidate.agent
                  ? tr("chat.composer.agentHint")
                  : candidate.label}
              </span>
            </div>
          ))}
        </div>
      )}
      <Textarea
        ref={input}
        data-testid="chat-composer"
        role="combobox"
        aria-label={tr("chat.composer.label")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        placeholder={tr("chat.composer.placeholder", {
          args: [props.room.name],
        })}
        value={value}
        rows={1}
        onChange={(event) => {
          setValue(event.target.value);
          track(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) =>
          track(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onBlur={() => setMention(undefined)}
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
