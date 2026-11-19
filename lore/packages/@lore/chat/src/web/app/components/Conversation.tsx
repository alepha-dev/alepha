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
  ChatRoomResource,
} from "../../../schemas/index.ts";
import ChatComposer, { type ChatMentionCandidate } from "./ChatComposer.tsx";
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
  onLoadOlder: () => void;
  /**
   * Resolves `true` when the message was sent, and the composer empties.
   */
  onSend: (body: string) => Promise<boolean>;
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
  const pinned = useRef(true);
  const previousHeight = useRef(0);
  const previousFirst = useRef<string | undefined>(undefined);

  const userById = useMemo(
    () => new Map(props.users.map((user) => [user.id, user])),
    [props.users],
  );
  const handles = useMemo(
    () => props.users.map((user) => ({ name: mentionHandle(user) })),
    [props.users],
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
    message.agent ??
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
    return (
      <ChatMessageRow
        key={message.id}
        message={message}
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
      />
    );
  });

  return (
    <section
      aria-label={room.name}
      className="flex h-full min-h-0 flex-col"
      data-testid="chat-conversation"
    >
      <header className="flex items-center gap-2 border-b px-4 py-2">
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
                className="ring-background size-6 ring-2"
              />
            ))}
          </span>
          <Users className="text-muted-foreground size-4" />
        </Button>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto pb-3"
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
        <div role="log" aria-label={tr("chat.room.messages")}>
          <ul>{rows}</ul>
        </div>
      </div>
      {room.archivedAt ? (
        <p className="text-muted-foreground border-t p-3 text-center text-sm">
          {tr("chat.room.archivedNotice")}
        </p>
      ) : props.canWrite ? (
        <ChatComposer
          room={room}
          candidates={props.candidates}
          onSend={props.onSend}
        />
      ) : (
        <p className="text-muted-foreground border-t p-3 text-center text-sm">
          {tr("chat.room.readOnly")}
        </p>
      )}
    </section>
  );
};

export default Conversation;
