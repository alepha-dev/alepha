import { Button, cn, TimeAgo, UserAvatar } from "@alepha/ui";
import {
  displayName,
  type I18n,
  LoreViewer,
  mentionHandle,
  type ProjectUser,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, Hash, Lock } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import type {
  ChatMessageResource,
  ChatRoomResource,
} from "../../../schemas/index.ts";
import { chatMarkdown } from "../services/chatMarkdown.ts";
import ChatComposer from "./ChatComposer.tsx";

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
  onLoadOlder: () => void;
  /**
   * Resolves `true` when the message was sent, and the composer empties.
   */
  onSend: (body: string) => Promise<boolean>;
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
  const Icon = room.private ? Lock : Hash;
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

  const rows: ReactNode[] = [];
  props.messages.forEach((message, index) => {
    const previous = props.messages[index - 1];
    const sameAuthor =
      !!previous &&
      !previous.deletedAt &&
      (previous.authorId ?? previous.agent) ===
        (message.authorId ?? message.agent) &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) <
        GROUP_WITHIN_MS;
    const mine = !!props.me && message.mentions.includes(props.me);
    rows.push(
      <li
        key={message.id}
        data-testid="chat-message"
        data-mentions-me={mine ? "true" : undefined}
        className={cn(
          "flex gap-3 px-4",
          sameAuthor ? "pt-0.5" : "pt-3",
          mine && "bg-amber-500/10",
        )}
      >
        <div className="w-8 shrink-0">
          {!sameAuthor && (
            <UserAvatar
              public
              user={
                message.authorId ? userById.get(message.authorId) : undefined
              }
              alt=""
              className="size-8"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!sameAuthor && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{authorOf(message)}</span>
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
                  members: handles,
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
      </li>,
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
        <Icon className="text-muted-foreground size-4" />
        <h1 className="min-w-0 flex-1 truncate font-medium">{room.name}</h1>
        <div className="flex -space-x-2" aria-label={tr("chat.room.members")}>
          {props.members.slice(0, 5).map((id) => (
            <UserAvatar
              key={id}
              public
              user={userById.get(id)}
              alt={displayName(userById.get(id))}
              className="ring-background size-6 ring-2"
            />
          ))}
        </div>
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
        <ul>{rows}</ul>
      </div>
      {room.archivedAt ? (
        <p className="text-muted-foreground border-t p-3 text-center text-sm">
          {tr("chat.room.archivedNotice")}
        </p>
      ) : props.canWrite ? (
        <ChatComposer room={room} onSend={props.onSend} />
      ) : (
        <p className="text-muted-foreground border-t p-3 text-center text-sm">
          {tr("chat.room.readOnly")}
        </p>
      )}
    </section>
  );
};

export default Conversation;
