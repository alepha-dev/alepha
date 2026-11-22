import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea,
} from "@alepha/ui";
import { DiscussionAttachments, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowUp, Bot, FileUp, Plus } from "lucide-react";
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

/**
 * A file uploaded for the next message, before it is sent.
 */
export interface ChatPendingFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ChatComposerProps {
  room: ChatRoomResource;
  candidates: ChatMentionCandidate[];
  /**
   * Resolves `true` when the message was sent. The composer empties at
   * once and gets its text and files back when this resolves `false`.
   */
  onSend: (body: string, files: ChatPendingFile[]) => Promise<boolean>;
  /**
   * Uploads one file for the next message; `undefined` when it failed (the
   * toast says why).
   */
  onUpload: (file: File) => Promise<ChatPendingFile | undefined>;
  /**
   * Called on every keystroke that changes the text; the page decides how
   * often to tell the room.
   */
  onTyping?: () => void;
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
  const [mention, setMention] = useState<
    { start: number; query: string } | undefined
  >(undefined);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<ChatPendingFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const picker = useRef<HTMLInputElement>(null);

  /**
   * Picked, pasted or dropped: each file is uploaded now, sent with the
   * next message.
   */
  const attach = async (files: File[]) => {
    for (const file of files) {
      setUploading((count) => count + 1);
      const uploaded = await props.onUpload(file);
      setUploading((count) => count - 1);
      if (uploaded) setPending((held) => [...held, uploaded]);
    }
  };

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

  // Empty on Enter, not when the server answers (#Q4112): the page shows
  // the message as pending meanwhile. A failed send gives the words and
  // files back, unless the member has started the next message.
  const send = async () => {
    const body = value.trim();
    if ((!body && pending.length === 0) || uploading > 0) return;
    const text = value;
    const files = pending;
    setValue("");
    setPending([]);
    setMention(undefined);
    const sent = await props.onSend(body, files);
    if (!sent) {
      setValue((current) => (current ? current : text));
      setPending((current) => (current.length ? current : files));
    }
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
      className="relative flex flex-col px-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        data-testid="chat-file-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void attach(files);
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={tr("chat.composer.mentions")}
          data-testid="chat-mention-popup"
          className="bg-popover text-popover-foreground absolute bottom-full left-3.5 mb-1 w-72 overflow-hidden rounded-md border p-1 shadow-md"
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
                index === active && "bg-hover text-foreground",
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
      {/* Discord's message bar: one filled block, the attach button on the
          left, Enter sends. The send button is kept for touch screens only,
          where there is no Enter to rely on. */}
      <div className="bg-muted hover:border-border-hover focus-within:border-border-hover flex flex-col rounded-lg border shadow-xs transition-colors">
        {/* The files waiting for the next message, inside the box above the
            text: the same tiles as a quest's or a feedback's discussion,
            an image zooming in the lightbox, each with its remove cross. */}
        {(pending.length > 0 || uploading > 0) && (
          <div
            className="px-2.5 pt-3"
            role="group"
            aria-label={tr("chat.composer.files")}
            data-testid="chat-pending-files"
          >
            <DiscussionAttachments
              items={pending}
              uploading={uploading}
              onRemove={(id) =>
                setPending((held) => held.filter((it) => it.id !== id))
              }
            />
          </div>
        )}
        <div className="flex items-start gap-1.5 pr-2 pl-2">
          {/* The `+` opens a menu, as on Discord: one entry today, room for
            more (a poll, a thread) without moving the button. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="minimal"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground my-2"
                  aria-label={tr("chat.composer.more")}
                  data-testid="chat-composer-more"
                />
              }
            >
              <Plus className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-48">
              <DropdownMenuItem onClick={() => picker.current?.click()}>
                <FileUp />
                {tr("chat.composer.attach")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              if (event.target.value.trim()) props.onTyping?.();
            }}
            onSelect={(event) =>
              track(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
              )
            }
            onBlur={() => setMention(undefined)}
            // Dropped on the text, as pasted: the files join the next message.
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files"))
                event.preventDefault();
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length === 0) return;
              event.preventDefault();
              void attach([...event.dataTransfer.files]);
            }}
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (files.length === 0) return;
              event.preventDefault();
              void attach(files);
            }}
            onKeyDown={onKeyDown}
            className="max-h-48 min-h-11 flex-1 resize-none rounded-none border-0 bg-transparent px-1 py-[11px] leading-[22px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="submit"
            size="icon-sm"
            className="my-2 md:hidden"
            aria-label={tr("chat.composer.send")}
            disabled={
              uploading > 0 ||
              (value.trim().length === 0 && pending.length === 0)
            }
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </form>
  );
};

export default ChatComposer;
