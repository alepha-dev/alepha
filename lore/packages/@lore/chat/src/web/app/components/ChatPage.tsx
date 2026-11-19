import { useIsMobile } from "@alepha/ui";
import {
  canInProject,
  currentProjectAtom,
  displayName,
  type I18n,
  mentionHandle,
  useProjectUsers,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInject,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { useSidebarState } from "alepha/react/ui";
import { MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessageController } from "../../../api/controllers/ChatMessageController.ts";
import type { ChatRoomController } from "../../../api/controllers/ChatRoomController.ts";
import type {
  ChatMessageResource,
  ChatRoomResource,
  ChatServerFrame,
} from "../../../schemas/index.ts";
import { useChatFeed } from "../hooks/useChatFeed.ts";
import { useRoomMessages } from "../hooks/useRoomMessages.ts";
import type { ChatMentionCandidate } from "./ChatComposer.tsx";
import Conversation from "./Conversation.tsx";
import RoomList from "./RoomList.tsx";

/**
 * The Chat page (#E161, #Q3929), layout C of the mockup: the room inbox on
 * the left, the open room on the right, the project sidebar folded to icons
 * while it is shown. `/<project>/chat/<room>` opens a room by its name.
 *
 * On a phone the list and the conversation are two screens.
 */
const ChatPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id ?? 0;
  const projectSlug = project?.slug ?? "";
  const router = useRouter();
  const state = useRouterState();
  const roomName = state.params.room as string | undefined;
  const me = useAuth().user?.id;
  const isMobile = useIsMobile();
  const users = useProjectUsers();
  const roomsApi = useClient<ChatRoomController>();
  const messagesApi = useClient<ChatMessageController>();
  const queries = useQueryClient();

  useFoldedSidebar();

  const roomsKey = ["chat-rooms", projectId];
  const unreadKey = ["chat-unread", projectId];
  const { data: roomPage } = useQuery(
    {
      key: roomsKey,
      enabled: projectId > 0,
      handler: () => roomsApi.listChatRooms({ params: { projectId } }),
    },
    [roomsApi, projectId],
  );
  const { data: unreadPage } = useQuery(
    {
      key: unreadKey,
      enabled: projectId > 0,
      handler: () => messagesApi.getChatUnreadCounts({ params: { projectId } }),
    },
    [messagesApi, projectId],
  );
  const rooms = roomPage?.items ?? [];
  const unread = useMemo(
    () =>
      new Map(
        (unreadPage?.items ?? []).map((row) => [
          row.roomId,
          { unread: row.unread, mentions: row.mentions },
        ]),
      ),
    [unreadPage],
  );

  // A room named in the URL, else `general` on a wide screen; a phone starts
  // on the list.
  const room: ChatRoomResource | undefined = roomName
    ? rooms.find((it) => it.name === roomName)
    : isMobile
      ? undefined
      : (rooms.find((it) => it.name === "general") ?? rooms[0]);

  const { data: memberPage } = useQuery(
    {
      key: ["chat-room-members", room?.id],
      enabled: !!room,
      handler: () =>
        roomsApi.listChatRoomMembers({
          params: { projectId, roomId: room!.id },
        }),
    },
    [roomsApi, projectId, room?.id],
  );

  const conversation = useRoomMessages(projectId, room?.id);

  // Lists refresh from frames, at most once per half second: a busy room
  // sends many.
  const refresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshLists = useCallback(() => {
    clearTimeout(refresh.current);
    refresh.current = setTimeout(() => {
      queries.invalidate(roomsKey);
      queries.invalidate(unreadKey);
    }, 500);
  }, [queries, projectId]);
  useEffect(() => () => clearTimeout(refresh.current), []);

  useChatFeed({
    onFrame: (frame: ChatServerFrame) => {
      conversation.apply(frame);
      if (frame.projectId === projectId) refreshLists();
    },
    onResync: () => {
      refreshLists();
      conversation.resync();
    },
  });

  // Opening a room, and every message that arrives while it is open and
  // the tab is seen, marks it read.
  const markRead = useAction<[roomId: string, messageId: string], void>(
    {
      handler: async (_context, roomId, messageId) => {
        await messagesApi.markChatRoomRead({
          params: { projectId, roomId },
          body: { messageId },
        });
        queries.invalidate(unreadKey);
      },
      // A read state that did not move is retried by the next message: it
      // is not worth a toast.
      onError: () => {},
    },
    [messagesApi, projectId],
  );
  const newest = conversation.messages.at(-1)?.id;
  const marked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!room || !newest || newest === marked.current) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    marked.current = newest;
    void markRead.run(room.id, newest);
  }, [room?.id, newest]);

  const open = (target?: ChatRoomResource) => {
    void router.push(target ? "projectChatRoom" : "projectChat", {
      params: {
        projectSlug,
        ...(target ? { room: target.name } : {}),
      },
    });
  };

  const sendMessage = useAction<[roomId: string, body: string], void>(
    {
      handler: async (_context, roomId, body) => {
        const message = await messagesApi.sendChatMessage({
          params: { projectId, roomId },
          body: { body },
        });
        conversation.add(message);
        refreshLists();
      },
    },
    [messagesApi, projectId, conversation.add, refreshLists],
  );

  // The composer keeps its text when the send failed: the toast says why,
  // and the words are not lost.
  const send = async (body: string): Promise<boolean> =>
    room ? (await sendMessage.run(room.id, body)).ok : false;

  const editMessage = useAction<
    [message: ChatMessageResource, body: string],
    void
  >(
    {
      handler: async (_context, message, body) => {
        const updated = await messagesApi.editChatMessage({
          params: { projectId, roomId: message.roomId, messageId: message.id },
          body: { body },
        });
        conversation.add(updated);
      },
    },
    [messagesApi, projectId, conversation.add],
  );

  const deleteMessage = useAction<[message: ChatMessageResource], void>(
    {
      handler: async (_context, message) => {
        await messagesApi.deleteChatMessage({
          params: { projectId, roomId: message.roomId, messageId: message.id },
        });
        conversation.apply({
          type: "message.deleted",
          projectId,
          roomId: message.roomId,
          messageId: message.id,
        });
        refreshLists();
      },
    },
    [messagesApi, projectId, conversation.apply, refreshLists],
  );

  // Who `@` offers: the members of a private room, everyone who reads an
  // open one; never the writer. Agents join with the agent quest.
  const candidates: ChatMentionCandidate[] = room?.private
    ? (memberPage?.items ?? [])
        .filter((member) => member.userId !== me && member.name)
        .map((member) => ({
          handle: member.name!,
          label: member.label ?? member.name!,
        }))
    : users
        .filter((user) => user.id !== me)
        .map((user) => ({
          handle: mentionHandle(user),
          label: displayName(user),
        }));

  const dateTime = useInject(DateTimeProvider);
  const [now] = useState(() => dateTime.nowMillis());

  const list = (
    <RoomList
      rooms={rooms}
      unread={unread}
      selectedId={room?.id}
      now={now}
      onOpen={open}
    />
  );

  const right = room ? (
    <Conversation
      room={room}
      projectId={projectId}
      projectSlug={projectSlug}
      me={me}
      users={users}
      members={(memberPage?.items ?? []).map((member) => member.userId)}
      messages={conversation.messages}
      hasMore={conversation.hasMore}
      loading={conversation.loading}
      canWrite={messagesApi.sendChatMessage.can()}
      canManage={!!project && canInProject(project, "chat:manage")}
      candidates={candidates}
      onEdit={async (message, body) =>
        (await editMessage.run(message, body)).ok
      }
      onDelete={async (message) => {
        await deleteMessage.run(message);
      }}
      onLoadOlder={conversation.loadOlder}
      onSend={send}
      onBack={isMobile ? () => open() : undefined}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <MessagesSquare className="text-muted-foreground size-8" />
      <p className="text-muted-foreground max-w-md text-sm">
        {roomName ? tr("chat.room.notFound") : tr("chat.page.pick")}
      </p>
    </div>
  );

  if (isMobile) {
    return <div className="h-full min-h-0">{room ? right : list}</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[18rem_1fr]">
      <div className="min-h-0 border-r">{list}</div>
      <div className="min-h-0">{right}</div>
    </div>
  );
};

/**
 * The project sidebar folds to icons while Chat is open, and goes back to
 * how it was on the way out. The header toggle still opens it.
 */
const useFoldedSidebar = () => {
  const { collapsed, setCollapsed } = useSidebarState();
  const before = useRef(collapsed);
  useEffect(() => {
    before.current = collapsed;
    setCollapsed(true);
    return () => setCollapsed(before.current);
  }, []);
};

export default ChatPage;
