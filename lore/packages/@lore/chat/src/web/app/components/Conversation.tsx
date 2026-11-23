import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  UserAvatar,
} from "@alepha/ui";
import {
  displayName,
  type I18n,
  mentionHandle,
  type ProjectUser,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Hash,
  Lock,
  MessagesSquare,
  Users,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type {
  ChatMessageResource,
  ChatReactionEmoji,
  ChatRoomResource,
} from "../../../schemas/index.ts";
import ChatComposer, {
  type ChatMentionCandidate,
  type ChatPendingFile,
} from "./ChatComposer.tsx";
import ChatMessageRow from "./ChatMessageRow.tsx";

/**
 * Two messages by the same author this close together share one header.
 */
const GROUP_WITHIN_MS = 5 * 60 * 1000;

export interface ConversationProps {
  room: ChatRoomResource;
  projectId: number;
  projectSlug: string;
  me?: string;
  users: ProjectUser[];
  members: string[];
  messages: ChatMessageResource[];
  hasMore: boolean;
  loading: boolean;
  canWrite: boolean;
  /**
   * `chat:manage`: deletes anyone's message.
   */
  canManage: boolean;
  /**
   * What the composer's `@` popup offers: who can see the room, agents
   * first.
   */
  candidates: ChatMentionCandidate[];
  /**
   * Resolves `true` when the edit was saved.
   */
  onEdit: (message: ChatMessageResource, body: string) => Promise<boolean>;
  onDelete: (message: ChatMessageResource) => Promise<void>;
  onReact: (message: ChatMessageResource, emoji: ChatReactionEmoji) => void;
  /**
   * The mentioner approves or denies the write an agent's answer waits on.
   */
  onDecide: (
    message: ChatMessageResource,
    decision: "approve" | "deny",
  ) => void;
  /**
   * The answer whose decision is being sent, if any.
   */
  deciding?: string;
  /**
   * The agents' names as the room shows them, `lore` as Lore.
   */
  agentLabels: Record<string, string>;
  onUpload: (file: File) => Promise<ChatPendingFile | undefined>;
  /**
   * Who is typing in the room now, other than the reader.
   */
  typing: string[];
  onTyping: () => void;
  onLoadOlder: () => void;
  /**
   * Resolves `true` when the message was sent, and the composer empties.
   */
  onSend: (body: string, files: ChatPendingFile[]) => Promise<boolean>;
  /**
   * The messages this tab sent that the server has not answered yet: drawn
   * as pending, with no actions.
   */
  sending?: ReadonlySet<string>;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /**
   * The bell in the header: the reader's notify level for this room. Only
   * for a member; a room one has not joined notifies nothing.
   */
  onNotify?: (level: "mentions" | "muted") => void;
  /**
   * The phone layout's way back to the room list.
   */
  onBack?: () => void;
}

/**
 * The right column of the Chat page (#E161, #Q3929): the room's header,
 * its messages grouped by author, and the composer.
 */
const Conversation = (props: ConversationProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { room } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const previousHeight = useRef(0);
  const previousFirst = useRef<string | undefined>(undefined);

  const userById = useMemo(
    () => new Map(props.users.map((user) => [user.id, user])),
    [props.users],
  );
  // Agents too: `@lore` reads as a mention like a member's handle.
  const handles = useMemo(
    () => [
      ...props.users.map((user) => ({ name: mentionHandle(user) })),
      ...props.candidates
        .filter((candidate) => candidate.agent)
        .map((candidate) => ({ name: candidate.handle })),
    ],
    [props.users, props.candidates],
  );

  // Stay at the bottom while the reader is there; keep the reader's place
  // when an older page is put above.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const first = props.messages[0]?.id;
    if (previousFirst.current && first !== previousFirst.current) {
      element.scrollTop += element.scrollHeight - previousHeight.current;
    } else if (pinned.current) {
      element.scrollTop = element.scrollHeight;
    }
    previousFirst.current = first;
    previousHeight.current = element.scrollHeight;
  }, [props.messages]);

  useEffect(() => {
    pinned.current = true;
    previousFirst.current = undefined;
  }, [room.id]);

  // Still at the bottom when the list's box or its content changes size: the
  // bar growing with a long draft, an image arriving after its message.
  useEffect(() => {
    const element = scroller.current;
    const content = log.current;
    if (!element || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Older pages load when the top of the list comes into view.
  useEffect(() => {
    const sentinel = top.current;
    if (
      !sentinel ||
      !props.hasMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) props.onLoadOlder();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [props.hasMore, props.onLoadOlder]);

  // A project agent is named by its row, read on the server, so a renamed
  // or deleted agent's answers show its current name (#Q4198).
  const authorOf = (message: ChatMessageResource): string =>
    message.agentName ||
    (message.agent && (props.agentLabels[message.agent] ?? message.agent)) ||
    (message.authorId
      ? displayName(
          userById.get(message.authorId),
          tr("chat.message.removedMember"),
        )
      : tr("chat.message.removedMember"));

  const rows = props.messages.map((message, index) => {
    const previous = props.messages[index - 1];
    const continued =
      !!previous &&
      !previous.deletedAt &&
      (previous.authorId ?? previous.agentId ?? previous.agent) ===
        (message.authorId ?? message.agentId ?? message.agent) &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) <
        GROUP_WITHIN_MS;
    const own = !!props.me && message.authorId === props.me;
    const pending = !!props.sending?.has(message.id);
    return (
      <ChatMessageRow
        key={message.id}
        message={message}
        pending={pending}
        author={authorOf(message)}
        user={message.authorId ? userById.get(message.authorId) : undefined}
        continued={continued}
        mentionsMe={!!props.me && message.mentions.includes(props.me)}
        projectId={props.projectId}
        projectSlug={props.projectSlug}
        handles={handles}
        canEdit={own && props.canWrite && !room.archivedAt}
        canDelete={own || props.canManage}
        onEdit={(body) => props.onEdit(message, body)}
        onDelete={() => props.onDelete(message)}
        me={props.me}
        agent={
          message.agentRun
            ? {
                mentioner: displayName(
                  userById.get(message.agentRun.mentionerId),
                  tr("chat.message.removedMember"),
                ),
                deciding: props.deciding === message.id,
                onDecide: (decision) => props.onDecide(message, decision),
              }
            : undefined
        }
        nameOf={(userId) =>
          displayName(userById.get(userId), tr("chat.message.removedMember"))
        }
        onReact={
          props.canWrite && !room.archivedAt
            ? (emoji) => props.onReact(message, emoji)
            : undefined
        }
      />
    );
  });

  return (
    <section
      aria-label={room.name}
      // The scheme of a DataTable: the messages are content on `bg-card`,
      // as a table's rows are, between two chrome bands, the header above
      // and the composer below. The page's black background (#Q4057) beside
      // the tinted list read as a hole.
      className="bg-card flex h-full min-h-0 flex-col"
      data-testid="chat-conversation"
    >
      <header className="chrome flex h-[46px] shrink-0 items-center gap-2 border-b pr-2.5 pl-3">
        {props.onBack && (
          <Button
            variant="minimal"
            size="icon"
            aria-label={tr("chat.rooms.back")}
            onClick={props.onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        {/* The room's name, plain: the list beside it is how one switches. */}
        <h2
          className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"
          data-testid="chat-room-title"
        >
          <Hash className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{room.name}</span>
          {room.private && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="text-muted-foreground flex shrink-0"
                    aria-label={tr("chat.room.private")}
                  />
                }
              >
                <Lock className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{tr("chat.room.private")}</TooltipContent>
            </Tooltip>
          )}
        </h2>
        <div className="flex-1" />
        {props.onNotify && (
          // The bell, as on Discord: the level is a choice in its menu, and
          // a muted room shows it crossed out.
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="minimal"
                  size="icon"
                  aria-label={tr("chat.room.notify.bell")}
                  data-testid="chat-room-notify"
                />
              }
            >
              {room.notifyLevel === "muted" ? <BellOff /> : <Bell />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuRadioGroup
                value={room.notifyLevel ?? "mentions"}
                onValueChange={(value) => {
                  if (value === "mentions" || value === "muted")
                    props.onNotify?.(value);
                }}
              >
                <DropdownMenuLabel>{tr("chat.room.notify")}</DropdownMenuLabel>
                <DropdownMenuRadioItem value="mentions">
                  {tr("chat.room.notify.mentions")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="muted">
                  {tr("chat.room.notify.muted")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="minimal"
          className="gap-1 px-1.5"
          aria-pressed={props.panelOpen}
          data-testid="chat-room-members-toggle"
          onClick={props.onTogglePanel}
        >
          <span className="sr-only">{tr("chat.room.members")}</span>
          {/* Faces, not words: the button's name is the line above. */}
          <span className="flex -space-x-2" aria-hidden="true">
            {props.members.slice(0, 5).map((id) => (
              <UserAvatar
                key={id}
                public
                user={userById.get(id)}
                alt=""
                className="ring-background size-5 ring-2"
              />
            ))}
          </span>
          <Users className="text-muted-foreground size-4" />
        </Button>
      </header>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto pt-3 pb-6"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
        }}
      >
        <div ref={top} />
        {props.hasMore && (
          <p className="text-muted-foreground py-2 text-center text-xs">
            {tr("chat.message.older")}
          </p>
        )}
        {/* Centred in the room, icon over text, as the page's own "no
            such room" state is. */}
        {props.messages.length === 0 && !props.loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center"
            data-testid="chat-room-empty"
          >
            <MessagesSquare className="text-muted-foreground size-8" />
            <p className="text-muted-foreground max-w-md text-sm">
              {tr("chat.room.empty")}
            </p>
          </div>
        )}
        {/* A log: a screen reader announces each new message politely. */}
        <div ref={log} role="log" aria-label={tr("chat.room.messages")}>
          <ul>{rows}</ul>
        </div>
      </div>
      {/* No band: the composer's box floats over the messages, raised on
          `bg-muted`, as on Discord. */}
      <div className="shrink-0 pt-1" data-testid="chat-composer-band">
        {room.archivedAt ? (
          <p className="text-muted-foreground bg-muted mx-3.5 rounded-lg border p-3 text-center text-sm">
            {tr("chat.room.archivedNotice")}
          </p>
        ) : props.canWrite ? (
          <ChatComposer
            room={room}
            candidates={props.candidates}
            onSend={props.onSend}
            onUpload={props.onUpload}
            onTyping={props.onTyping}
          />
        ) : (
          <p className="text-muted-foreground bg-muted mx-3.5 rounded-lg border p-3 text-center text-sm">
            {tr("chat.room.readOnly")}
          </p>
        )}
        {/* Under the bar, as on Discord: who is typing. 14px tall, the box's
            side margin, so the space under the box equals the space beside
            it; the line sits in that space. */}
        <div className="text-muted-foreground flex h-3.5 items-center px-[18px] text-[11px] leading-[14px]">
          <span aria-live="polite" data-testid="chat-typing">
            {props.typing.length === 1
              ? tr("chat.room.typing.one", {
                  args: [displayName(userById.get(props.typing[0]!))],
                })
              : props.typing.length > 1
                ? tr("chat.room.typing.many", {
                    args: [String(props.typing.length)],
                  })
                : ""}
          </span>
        </div>
      </div>
    </section>
  );
};

export default Conversation;
