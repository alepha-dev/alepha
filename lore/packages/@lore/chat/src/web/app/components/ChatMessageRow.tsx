import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea,
  TimeAgo,
  useDialog,
  UserAvatar,
} from "@alepha/ui";
import { type I18n, LoreViewer, type ProjectUser } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { ChatMessageResource } from "../../../schemas/index.ts";
import { chatMarkdown } from "../services/chatMarkdown.ts";

export interface ChatMessageRowProps {
  message: ChatMessageResource;
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
}

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
    !message.deletedAt &&
    draft === undefined &&
    (props.canEdit || props.canDelete);

  return (
    <li
      data-testid="chat-message"
      data-mentions-me={props.mentionsMe ? "true" : undefined}
      className={cn(
        "group relative flex gap-3 px-4",
        props.continued ? "pt-0.5" : "pt-3",
        props.mentionsMe && "bg-amber-500/10",
      )}
    >
      <div className="w-8 shrink-0">
        {!props.continued && (
          <UserAvatar public user={props.user} alt="" className="size-8" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!props.continued && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{props.author}</span>
            <TimeAgo
              value={message.createdAt}
              className="text-muted-foreground text-xs"
            />
          </div>
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
          </div>
        )}
      </div>
      {actions && (
        <div className="absolute top-1 right-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outlined"
                  size="icon-xs"
                  aria-label={tr("chat.message.actions")}
                />
              }
            >
              <Ellipsis className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {props.canEdit && (
                <DropdownMenuItem onClick={() => setDraft(message.body)}>
                  <Pencil className="size-4" />
                  {tr("chat.message.edit")}
                </DropdownMenuItem>
              )}
              {props.canDelete && (
                <DropdownMenuItem onClick={() => void remove()}>
                  <Trash2 className="size-4" />
                  {tr("chat.message.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
};

export default ChatMessageRow;
