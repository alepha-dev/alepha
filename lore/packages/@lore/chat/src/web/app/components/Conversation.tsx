import { Button, UserAvatar } from "@alepha/ui";
import {
  displayName,
  type I18n,
  mentionHandle,
  type ProjectUser,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, Users } from "lucide-react";
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
import RoomJumpList from "./RoomJumpList.tsx";

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
  /**
   * Every room the reader can see, for the jump list.
   */
  rooms: ChatRoomResource[];
  onOpenRoom: (room: ChatRoomResource) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
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

  const authorOf = (message: ChatMessageResource): string =>
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
      (previous.authorId ?? previous.agent) ===
        (message.authorId ?? message.agent) &&
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
      // The room on the page's own background (#Q4057), where a message's
      // hover tint shows; the composer is a band of its own below.
      className="bg-background flex h-full min-h-0 flex-col"
      data-testid="chat-conversation"
    >
      <header className="flex h-[46px] shrink-0 items-center gap-2 border-b pr-2.5 pl-3">
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
        <RoomJumpList
          room={room}
          rooms={props.rooms}
          onOpen={props.onOpenRoom}
        />
        <div className="flex-1" />
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
        className="min-h-0 flex-1 overflow-y-auto pt-3 pb-6"
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
        {props.messages.length === 0 && !props.loading && (
          <p className="text-muted-foreground p-6 text-center text-sm">
            {tr("chat.room.empty")}
          </p>
        )}
        {/* A log: a screen reader announces each new message politely. */}
        <div ref={log} role="log" aria-label={tr("chat.room.messages")}>
          <ul>{rows}</ul>
        </div>
      </div>
      {/* The composer's band (#Q4057): the chrome tint, the box white on it. */}
      <div
        className="bg-muted shrink-0 border-t pt-3"
        data-testid="chat-composer-band"
      >
        {room.archivedAt ? (
          <p className="text-muted-foreground bg-background border-foreground/20 mx-3.5 rounded-lg border p-3 text-center text-sm">
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
          <p className="text-muted-foreground bg-background border-foreground/20 mx-3.5 rounded-lg border p-3 text-center text-sm">
            {tr("chat.room.readOnly")}
          </p>
        )}
        {/* Under the bar, as on Discord: who is typing, else how to talk. */}
        <div className="text-muted-foreground flex h-6 items-center px-[18px] text-[11px]">
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
          {props.typing.length === 0 &&
            !room.archivedAt &&
            props.canWrite &&
            tr("chat.composer.hint")}
        </div>
      </div>
    </section>
  );
};

export default Conversation;
