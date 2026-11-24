import { PaneResizer, useDialog, useIsMobile } from "@alepha/ui";
import {
  canInProject,
  currentProjectAtom,
  DOCK_UNREAD_KEY,
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
import { MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatAgentController } from "../../../api/controllers/ChatAgentController.ts";
import type { ChatMessageController } from "../../../api/controllers/ChatMessageController.ts";
import type { ChatRoomController } from "../../../api/controllers/ChatRoomController.ts";
import type {
  ChatMessageResource,
  ChatReactionEmoji,
  ChatRoomResource,
  ChatServerFrame,
} from "../../../schemas/index.ts";
import { chatRoomListWidthAtom } from "../atoms/chatRoomListWidthAtom.ts";
import { useRoomMessages } from "../hooks/useRoomMessages.ts";
import { roomRenameFormSchema } from "../schemas/roomRenameFormSchema.ts";
import { ChatFeedHub } from "../services/ChatFeedHub.ts";
import { ChatUnread } from "../services/ChatUnread.ts";
import { offeredAgents } from "../services/offeredAgents.ts";
import type { ChatMentionCandidate, ChatPendingFile } from "./ChatComposer.tsx";
import Conversation from "./Conversation.tsx";
import NewRoomDialog from "./NewRoomDialog.tsx";
import RoomList from "./RoomList.tsx";
import type { RoomListRowAction } from "./RoomListRow.tsx";
import RoomMembersPanel from "./RoomMembersPanel.tsx";

/**
 * How long "is typing" stays without a new frame, and how often a typing
 * member's page sends one.
 */
const TYPING_FOR_MS = 6000;
const TYPING_EVERY_MS = 3000;

/**
 * The Chat page (#E161, #Q3929), layout C of the mockup: the room inbox on
 * the left, the open room on the right. The project sidebar is left as the
 * reader set it. `/<project>/chat/<room>` opens a room by its name.
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
  const dialogs = useDialog();
  // The room list's width: the cookie's, and the drag's while one is under
  // way, so a drag repaints without writing the cookie on every move.
  const [listWidth, setListWidth] = useStore(chatRoomListWidthAtom);
  const [dragWidth, setDragWidth] = useState<number | undefined>();
  const users = useProjectUsers();
  const roomsApi = useClient<ChatRoomController>();
  const messagesApi = useClient<ChatMessageController>();
  const agentsApi = useClient<ChatAgentController>();
  const queries = useQueryClient();
  const hub = useInject(ChatFeedHub);
  const unreadBadge = useInject(ChatUnread);
  const dateTime = useInject(DateTimeProvider);

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
        // The room's mentions were marked read with it: the dock's badge,
        // which counts them, reads again in this tab at once (#Q4191).
        queries.invalidate([DOCK_UNREAD_KEY]);
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
        return {
          id: uploaded.id,
          name: uploaded.name,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
        };
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
      handler: () => agentsApi.listChatAgents({ params: { projectId } }),
    },
    [agentsApi, projectId],
  );
  // With AI off no agent answers, so none is offered (#E170).
  const agents = offeredAgents(agentPage);
  const agentLabels = Object.fromEntries(
    agents.map((agent) => [agent.handle, agent.label]),
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
  const candidates: ChatMentionCandidate[] = [...agents, ...people];

  const [now] = useState(() => dateTime.nowMillis());

  const [creating, setCreating] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const canManage = !!project && canInProject(project, "chat:manage");

  // A room row's "...": join, rename, archive or unarchive, leave. The
  // members panel shows members only; the server checks each verb again.
  type RoomVerb = "join" | "archive" | "unarchive" | "leave";
  const roomVerb = useAction<[target: ChatRoomResource, verb: RoomVerb], void>(
    {
      handler: async (_context, target, verb) => {
        const params = { projectId, roomId: target.id };
        if (verb === "join") await roomsApi.joinChatRoom({ params });
        else if (verb === "leave") await roomsApi.leaveChatRoom({ params });
        else if (verb === "archive") await roomsApi.archiveChatRoom({ params });
        else await roomsApi.unarchiveChatRoom({ params });
        queries.invalidate(["chat-room-members", target.id]);
        refreshLists();
      },
    },
    [roomsApi, projectId, queries, refreshLists],
  );
  const renameRoom = useAction<[target: ChatRoomResource, name: string], void>(
    {
      handler: async (_context, target, name) => {
        const renamed = await roomsApi.renameChatRoom({
          params: { projectId, roomId: target.id },
          body: { name },
        });
        refreshLists();
        // The open room is addressed by its name: follow it.
        if (target.id === room?.id) open(renamed);
      },
    },
    [roomsApi, projectId, refreshLists, room?.id],
  );
  const askRename = async (target: ChatRoomResource) => {
    const name = await dialogs.prompt({
      title: tr("chat.room.rename.title"),
      label: tr("chat.room.rename"),
      defaultValue: target.name,
      confirmLabel: tr("chat.room.rename.submit"),
      validate: (value) =>
        roomRenameFormSchema.safeParse({ name: value }).success
          ? null
          : tr("chat.room.new.nameHelp"),
    });
    if (name && name !== target.name) void renameRoom.run(target, name);
  };
  const notifyLevel = useAction<[level: "mentions" | "muted"], void>(
    {
      handler: async (_context, level) => {
        if (!room) return;
        await messagesApi.setChatRoomNotifyLevel({
          params: { projectId, roomId: room.id },
          body: { level },
        });
        refreshLists();
      },
    },
    [messagesApi, projectId, room?.id, refreshLists],
  );
  // The list's order, for everyone: saved on a drop, by chat:manage only.
  const reorderRooms = useAction<[roomIds: string[]], void>(
    {
      handler: async (_context, roomIds) => {
        await roomsApi.reorderChatRooms({
          params: { projectId },
          body: { roomIds },
        });
        refreshLists();
      },
    },
    [roomsApi, projectId, refreshLists],
  );

  const actionsFor = (target: ChatRoomResource): RoomListRowAction[] => {
    const actions: RoomListRowAction[] = [];
    const busy = roomVerb.loading || renameRoom.loading;
    const manages = canManage || (!!me && target.createdBy === me);
    if (
      !target.private &&
      !target.joined &&
      !target.archivedAt &&
      roomsApi.joinChatRoom.can()
    ) {
      actions.push({
        key: "join",
        label: tr("chat.room.join"),
        disabled: busy,
        onSelect: () => void roomVerb.run(target, "join"),
      });
    }
    if (manages && !target.archivedAt) {
      actions.push({
        key: "rename",
        label: tr("chat.room.rename.action"),
        disabled: busy,
        onSelect: () => void askRename(target),
      });
    }
    if (manages) {
      actions.push(
        target.archivedAt
          ? {
              key: "unarchive",
              label: tr("chat.room.unarchive"),
              disabled: busy,
              onSelect: () => void roomVerb.run(target, "unarchive"),
            }
          : {
              key: "archive",
              label: tr("chat.room.archive"),
              disabled: busy,
              onSelect: () => void roomVerb.run(target, "archive"),
            },
      );
    }
    if (target.joined) {
      actions.push({
        key: "leave",
        label: tr("chat.room.leave"),
        destructive: true,
        disabled: busy,
        onSelect: () => void roomVerb.run(target, "leave"),
      });
    }
    return actions;
  };

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
      actionsFor={actionsFor}
      onReorder={
        canManage ? (roomIds) => void reorderRooms.run(roomIds) : undefined
      }
    />
  );

  const right = room ? (
    <Conversation
      room={room}
      onNotify={
        room.joined ? (level) => void notifyLevel.run(level) : undefined
      }
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
    // Content, on `bg-card` as the conversation it stands in for, not the
    // page's dotted background.
    <div className="bg-card flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
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
        agents={memberPage?.agents ?? []}
        agentLabels={agentLabels}
        onClose={() => setPanelOpen(false)}
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

  const width = dragWidth ?? listWidth.width ?? LIST_DEFAULT_WIDTH;

  return (
    <div
      className="grid h-full min-h-0"
      style={{
        gridTemplateColumns: panel ? `${width}px 1fr 18rem` : `${width}px 1fr`,
      }}
    >
      {/* Resized by dragging its edge, with the shared handle the quest log
          and the folio tree use: it draws the edge's rule itself. */}
      <div className="relative min-h-0">
        {list}
        <PaneResizer
          width={listWidth.width ?? LIST_DEFAULT_WIDTH}
          minWidth={LIST_MIN_WIDTH}
          maxWidth={LIST_MAX_WIDTH}
          defaultWidth={LIST_DEFAULT_WIDTH}
          onResize={setDragWidth}
          onWidth={(next) => {
            setDragWidth(undefined);
            setListWidth({ width: next });
          }}
        />
      </div>
      <div className="min-h-0">{right}</div>
      {panel}
      {dialog}
    </div>
  );
};

/**
 * The room list's width bounds and default, in pixels: 296 is the 18.5rem
 * it had when it was fixed.
 */
const LIST_MIN_WIDTH = 220;
const LIST_MAX_WIDTH = 480;
const LIST_DEFAULT_WIDTH = 296;

export default ChatPage;
