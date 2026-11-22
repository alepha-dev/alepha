import {
  Badge,
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  TimeAgo,
  useDialog,
  UserAvatar,
} from "@alepha/ui";
import {
  DiscussionAttachments,
  type I18n,
  LoreViewer,
  type ProjectUser,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Bot, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type {
  ChatMessageResource,
  ChatReactionEmoji,
} from "../../../schemas/index.ts";
import { chatMarkdown } from "../services/chatMarkdown.ts";
import ChatAgentAnswer from "./ChatAgentAnswer.tsx";

export interface ChatMessageRowProps {
  message: ChatMessageResource;
  /**
   * Sent by this tab, not answered yet (#Q4112): dimmed, with no actions.
   */
  pending?: boolean;
  author: string;
  user?: ProjectUser;
  /**
   * The previous message has the same author and is recent: no header.
   */
  continued: boolean;
  /**
   * The message mentions the reader: highlighted.
   */
  mentionsMe: boolean;
  projectId: number;
  projectSlug: string;
  handles: Array<{ name: string }>;
  canEdit: boolean;
  canDelete: boolean;
  /**
   * Resolves `true` when the edit was saved, and the editor closes.
   */
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  /**
   * The reader, whose own reactions are pressed.
   */
  me?: string;
  /**
   * The name of a member who reacted, for the reaction's tooltip.
   */
  nameOf: (userId: string) => string;
  /**
   * Toggles the reader's emoji, absent when they may not react.
   */
  onReact?: (emoji: ChatReactionEmoji) => void;
  /**
   * An agent's answer: who asked it, and the decision on a paused write.
   */
  agent?: {
    mentioner: string;
    deciding: boolean;
    onDecide: (decision: "approve" | "deny") => void;
  };
}

/**
 * The fixed set a member reacts with: no custom emoji.
 */
const EMOJI: ChatReactionEmoji[] = ["👍", "❤️", "😄", "🎉", "👀", "🙏"];

/**
 * One message of the conversation (#E161, #Q3929, #Q3937): its author and
 * time unless it continues the previous one, its Markdown body, and, on a
 * message the reader may change, a menu with Edit and Delete.
 *
 * The menu's button is in the tab order and shows on hover or focus, so it
 * is reached by keyboard as well as by mouse.
 */
const ChatMessageRow = (props: ChatMessageRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const { message } = props;
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== undefined;

  // The editor takes focus when it opens, as the menu item asked.
  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);

  const save = async () => {
    const body = draft?.trim();
    if (!body || saving) return;
    setSaving(true);
    const saved = await props.onEdit(body);
    setSaving(false);
    if (saved) setDraft(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(undefined);
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void save();
    }
  };

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: tr("chat.message.delete.title"),
      description: tr("chat.message.delete.description"),
      confirmLabel: tr("chat.message.delete.confirm"),
      destructive: true,
    });
    if (confirmed) await props.onDelete();
  };

  const actions =
    !props.pending &&
    !message.deletedAt &&
    draft === undefined &&
    (props.canEdit || props.canDelete || !!props.onReact);

  return (
    <li
      data-testid="chat-message"
      data-mentions-me={props.mentionsMe ? "true" : undefined}
      data-pending={props.pending ? "true" : undefined}
      aria-busy={props.pending || undefined}
      className={cn(
        props.pending && "opacity-60",
        "group hover:bg-foreground/7 focus-within:bg-foreground/7 has-[[data-popup-open]]:bg-foreground/7 relative flex gap-2.5 px-3.5 py-0.5",
        !props.continued && "mt-2",
        props.mentionsMe &&
          "bg-amber-500/10 shadow-[inset_2px_0_0_var(--color-amber-500)]",
      )}
    >
      <div className="w-[30px] shrink-0">
        {!props.continued &&
          (message.agent ? (
            <span className="bg-primary/10 text-primary flex size-[30px] items-center justify-center rounded-[9px]">
              <Bot className="size-4" aria-hidden="true" />
            </span>
          ) : (
            <UserAvatar
              public
              user={props.user}
              alt=""
              className="size-[30px]"
            />
          ))}
      </div>
      <div className="min-w-0 flex-1">
        {!props.continued && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold">{props.author}</span>
            {message.agent && (
              <Badge variant="tint" tone="violet">
                {tr("chat.agent.tag")}
              </Badge>
            )}
            {props.pending ? (
              <span className="text-muted-foreground text-[11px]">
                {tr("chat.message.sending")}
              </span>
            ) : (
              <TimeAgo
                value={message.createdAt}
                className="text-muted-foreground text-[11px]"
              />
            )}
          </div>
        )}
        {message.agent && props.agent && (
          <ChatAgentAnswer
            message={message}
            me={props.me}
            mentioner={props.agent.mentioner}
            deciding={props.agent.deciding}
            onDecide={props.agent.onDecide}
            part="trace"
          />
        )}
        {message.deletedAt ? (
          <p className="text-muted-foreground text-sm italic">
            {tr("chat.message.deleted")}
          </p>
        ) : draft !== undefined ? (
          <div className="flex flex-col gap-1.5 py-1">
            <Textarea
              ref={editor}
              aria-label={tr("chat.message.edit.label")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              className="min-h-9 resize-none text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {tr("chat.message.edit.save")}
              </Button>
              <Button
                size="sm"
                variant="minimal"
                onClick={() => setDraft(undefined)}
              >
                {tr("chat.message.edit.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm">
            <LoreViewer
              // A chat line, not a document: no space above the first
              // paragraph, tighter paragraphs, the room's line height.
              className={cn(
                "leading-[1.45]! [&_p]:my-1.5 [&>:first-child]:mt-0 [&>:last-child]:mb-0",
                // A mention is a pill, blue on blue, as in Slack.
                "[&_a[href*='?mention=']]:rounded [&_a[href*='?mention=']]:bg-blue-500/15 [&_a[href*='?mention=']]:px-0.5 [&_a[href*='?mention=']]:font-medium [&_a[href*='?mention=']]:text-blue-700 [&_a[href*='?mention=']]:no-underline [&_a[href*='?mention=']]:hover:bg-blue-500/25 dark:[&_a[href*='?mention=']]:text-blue-300",
              )}
              element={{
                kind: "chat",
                projectId: props.projectId,
                projectSlug: props.projectSlug,
                id: message.id,
              }}
              content={chatMarkdown(message.body, {
                projectSlug: props.projectSlug,
                members: props.handles,
              })}
            />
            {message.editedAt && (
              <span className="text-muted-foreground text-xs">
                {tr("chat.message.edited")}
              </span>
            )}
            {/* The files, as tiles: an image zooms in the lightbox, as on a
                quest or a feedback item. */}
            {message.attachments.length > 0 && (
              <div
                className="mt-1"
                role="group"
                aria-label={tr("chat.message.files")}
              >
                <DiscussionAttachments items={message.attachments} />
              </div>
            )}
          </div>
        )}
        {message.agent && props.agent && (
          <ChatAgentAnswer
            message={message}
            me={props.me}
            mentioner={props.agent.mentioner}
            deciding={props.agent.deciding}
            onDecide={props.agent.onDecide}
            part="after"
          />
        )}
        {!message.deletedAt && message.reactions.length > 0 && (
          <div
            className="mt-1 flex flex-wrap gap-1"
            data-testid="chat-reactions"
          >
            {message.reactions.map((reaction) => {
              const mine = !!props.me && reaction.userIds.includes(props.me);
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  aria-pressed={mine}
                  disabled={!props.onReact}
                  title={reaction.userIds.map(props.nameOf).join(", ")}
                  onClick={() =>
                    props.onReact?.(reaction.emoji as ChatReactionEmoji)
                  }
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs",
                    mine ? "border-primary bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  {reaction.emoji} {reaction.userIds.length}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {actions && (
        // Discord's hover bar: one floating block over the row's top edge,
        // every action one click away.
        <div className="bg-background absolute -top-4 right-4 z-10 flex items-center rounded-lg border p-0.5 opacity-0 shadow-sm group-hover:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100">
          {props.onReact && (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="minimal"
                    size="icon-sm"
                    aria-label={tr("chat.message.react")}
                  />
                }
              >
                <SmilePlus className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-auto gap-1 p-1">
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emoji}
                    className="hover:bg-accent rounded-md px-1.5 py-1 text-base"
                    onClick={() => props.onReact?.(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {props.canEdit && (
            <Button
              variant="minimal"
              size="icon-sm"
              aria-label={tr("chat.message.edit")}
              onClick={() => setDraft(message.body)}
            >
              <Pencil className="size-4" />
            </Button>
          )}
          {props.canDelete && (
            <Button
              variant="minimal"
              size="icon-sm"
              intent="danger"
              aria-label={tr("chat.message.delete")}
              onClick={() => void remove()}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
};

export default ChatMessageRow;
