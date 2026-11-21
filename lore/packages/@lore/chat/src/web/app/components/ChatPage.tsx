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
  ChatReactionEmoji,
  ChatRoomResource,
  ChatServerFrame,
} from "../../../schemas/index.ts";
import { useRoomMessages } from "../hooks/useRoomMessages.ts";
import { ChatFeedHub } from "../services/ChatFeedHub.ts";
import { ChatUnread } from "../services/ChatUnread.ts";
import type { ChatMentionCandidate, ChatPendingFile } from "./ChatComposer.tsx";
import Conversation from "./Conversation.tsx";
import NewRoomDialog from "./NewRoomDialog.tsx";
import RoomList from "./RoomList.tsx";
import RoomMembersPanel from "./RoomMembersPanel.tsx";

/**
 * How long "is typing" stays without a new frame, and how often a typing
 * member's page sends one.
 */
const TYPING_FOR_MS = 6000;
const TYPING_EVERY_MS = 3000;

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
  const hub = useInject(ChatFeedHub);
  const unreadBadge = useInject(ChatUnread);
  const dateTime = useInject(DateTimeProvider);

  useFoldedSidebar();

  const roomsKey = ["chat-rooms", projectId];
  const unreadKey = ["chat-unread", projectId];
  const { data: roomPage } = useQuery(
    {
      key: roomsKey,
      enabled: projectId > 0,
      // Every sent or arriving message refreshes this list. Without the old
      // list held while it reloads, the open room vanished for a frame and
      // the whole conversation remounted: the flicker on each send.
      keepPreviousData: true,
      handler: () => roomsApi.listChatRooms({ params: { projectId } }),
    },
    [roomsApi, projectId],
  );
  const { data: unreadPage } = useQuery(
    {
      key: unreadKey,
      enabled: projectId > 0,
      keepPreviousData: true,
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
      keepPreviousData: true,
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

  // Who is typing in the open room, each until a few seconds pass or
  // their message arrives. Never stored.
  const [typing, setTyping] = useState<
    Array<{ userId: string; until: number }>
  >([]);
  useEffect(() => {
    if (typing.length === 0) return;
    const next = Math.min(...typing.map((it) => it.until));
    const timer = setTimeout(
      () => {
        const now = dateTime.nowMillis();
        setTyping((held) => held.filter((it) => it.until > now));
      },
      Math.max(next - dateTime.nowMillis(), 0) + 50,
    );
    return () => clearTimeout(timer);
  }, [typing]);

  // The page's frames come from the one feed at the layout's root.
  const onFrame = useRef<(frame: ChatServerFrame) => void>(() => {});
  onFrame.current = (frame) => {
    if (frame.projectId !== projectId) return;
    if (frame.type === "typing") {
      if (frame.roomId !== room?.id || frame.userId === me) return;
      const until = dateTime.nowMillis() + TYPING_FOR_MS;
      setTyping((held) => [
        ...held.filter((it) => it.userId !== frame.userId),
        { userId: frame.userId, until },
      ]);
      return;
    }
    conversation.apply(frame);
    if (frame.type === "message.created") {
      const author = frame.message.authorId;
      setTyping((held) => held.filter((it) => it.userId !== author));
    }
    refreshLists();
    if (frame.type === "room.changed") {
      queries.invalidate(["chat-room-members", frame.roomId]);
    }
  };
  const onResync = useRef<() => void>(() => {});
  onResync.current = () => {
    refreshLists();
    conversation.resync();
  };
  useEffect(() => {
    const off = [
      hub.onFrame((frame) => onFrame.current(frame)),
      hub.onResync(() => onResync.current()),
    ];
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }, [hub]);

  // "Is typing", sent at most every few seconds while the member types.
  const lastTyping = useRef(0);
  const onTyping = () => {
    if (!room) return;
    const now = dateTime.nowMillis();
    if (now - lastTyping.current < TYPING_EVERY_MS) return;
    lastTyping.current = now;
    hub.send({ type: "typing", projectId, roomId: room.id });
  };

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
        unreadBadge.refresh(projectId);
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

  const sendMessage = useAction<
    [roomId: string, body: string, attachments: string[]],
    void
  >(
    {
      handler: async (_context, roomId, body, attachments) => {
        const message = await messagesApi.sendChatMessage({
          params: { projectId, roomId },
          body: {
            ...(body ? { body } : {}),
            ...(attachments.length ? { attachments } : {}),
          },
        });
        conversation.add(message);
        refreshLists();
      },
    },
    [messagesApi, projectId, conversation.add, refreshLists],
  );

  // The message shows as pending at once (#Q4112). The composer gets its
  // text back when the send failed: the toast says why, and the words are
  // not lost.
  const send = async (
    body: string,
    files: ChatPendingFile[],
  ): Promise<boolean> => {
    if (!room) return false;
    const local = conversation.pend({
      roomId: room.id,
      authorId: me,
      body,
      files,
    });
    const result = await sendMessage.run(
      room.id,
      body,
      files.map((file) => file.id),
    );
    conversation.settle(local);
    return result.ok;
  };

  const uploadFile = useAction<[file: File], ChatPendingFile>(
    {
      handler: async (_context, file) => {
        const uploaded = await messagesApi.uploadChatAttachment({
          params: { projectId },
          body: { file },
        });
        return { id: uploaded.id, name: uploaded.name };
      },
    },
    [messagesApi, projectId],
  );

  const react = useAction<
    [message: ChatMessageResource, emoji: ChatReactionEmoji],
    void
  >(
    {
      handler: async (_context, message, emoji) => {
        const updated = await messagesApi.toggleChatReaction({
          params: { projectId, roomId: message.roomId, messageId: message.id },
          body: { emoji },
        });
        conversation.add(updated);
      },
    },
    [messagesApi, projectId, conversation.add],
  );

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

  const { data: agentPage } = useQuery(
    {
      key: ["chat-agents", projectId],
      enabled: projectId > 0,
      handler: () => messagesApi.listChatAgents({ params: { projectId } }),
    },
    [messagesApi, projectId],
  );
  const agents = agentPage?.items ?? [];
  const agentLabels = Object.fromEntries(
    agents.map((agent) => [agent.name, agent.label]),
  );

  const decide = useAction<
    [message: ChatMessageResource, decision: "approve" | "deny"],
    void
  >(
    {
      handler: async (_context, message, decision) => {
        await messagesApi.decideChatAgentCall({
          params: { projectId, roomId: message.roomId, messageId: message.id },
          body: { decision },
        });
      },
    },
    [messagesApi, projectId],
  );
  const [deciding, setDeciding] = useState<string | undefined>(undefined);

  // Who `@` offers: the agents first, then the members of a private room or
  // everyone who reads an open one; never the writer.
  const people: ChatMentionCandidate[] = room?.private
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
  const candidates: ChatMentionCandidate[] = [
    ...agents.map((agent) => ({
      handle: agent.name,
      label: agent.label,
      agent: true,
    })),
    ...people,
  ];

  const [now] = useState(() => dateTime.nowMillis());

  const [creating, setCreating] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const canManage = !!project && canInProject(project, "chat:manage");

  const list = (
    <RoomList
      onCreate={
        roomsApi.createChatRoom.can() ? () => setCreating(true) : undefined
      }
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
      sending={conversation.sending}
      hasMore={conversation.hasMore}
      loading={conversation.loading}
      canWrite={messagesApi.sendChatMessage.can()}
      canManage={canManage}
      rooms={rooms}
      onOpenRoom={open}
      panelOpen={panelOpen}
      onTogglePanel={() => setPanelOpen((value) => !value)}
      candidates={candidates}
      onEdit={async (message, body) =>
        (await editMessage.run(message, body)).ok
      }
      onDelete={async (message) => {
        await deleteMessage.run(message);
      }}
      onLoadOlder={conversation.loadOlder}
      onSend={send}
      onUpload={async (file) => {
        const result = await uploadFile.run(file);
        return result.ok ? result.value : undefined;
      }}
      onReact={(message, emoji) => void react.run(message, emoji)}
      agentLabels={agentLabels}
      deciding={deciding}
      onDecide={(message, decision) => {
        setDeciding(message.id);
        void decide
          .run(message, decision)
          .finally(() => setDeciding(undefined));
      }}
      onBack={isMobile ? () => open() : undefined}
      typing={typing.map((it) => it.userId)}
      onTyping={onTyping}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <MessagesSquare className="text-muted-foreground size-8" />
      <p className="text-muted-foreground max-w-md text-sm">
        {roomName ? tr("chat.room.notFound") : tr("chat.page.pick")}
      </p>
    </div>
  );

  const panel =
    room && panelOpen ? (
      <RoomMembersPanel
        room={room}
        projectId={projectId}
        me={me}
        canManage={canManage}
        users={users}
        members={memberPage?.items ?? []}
        onClose={() => setPanelOpen(false)}
        onRenamed={(renamed) => open(renamed)}
      />
    ) : undefined;

  const dialog = (
    <NewRoomDialog
      open={creating}
      projectId={projectId}
      onOpenChange={setCreating}
      onCreated={(created) => open(created)}
    />
  );

  if (isMobile) {
    return (
      <div className="h-full min-h-0">
        {panel ?? (room ? right : list)}
        {dialog}
      </div>
    );
  }

  return (
    <div
      className={
        panel
          ? "grid h-full min-h-0 grid-cols-[18.5rem_1fr_18rem]"
          : "grid h-full min-h-0 grid-cols-[18.5rem_1fr]"
      }
    >
      <div className="min-h-0 border-r">{list}</div>
      <div className="min-h-0">{right}</div>
      {panel}
      {dialog}
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
    // The fold is remembered in a cookie, so it is undone on the way out:
    // on unmount for a navigation inside the app, on `pagehide` for a
    // reload or a link that leaves the page, which unmounts nothing.
    const restore = () => setCollapsed(before.current);
    window.addEventListener("pagehide", restore);
    return () => {
      window.removeEventListener("pagehide", restore);
      restore();
    };
  }, []);
};

export default ChatPage;
