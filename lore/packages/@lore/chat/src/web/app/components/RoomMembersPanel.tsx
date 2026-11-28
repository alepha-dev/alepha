import { Button, UserAvatar } from "@alepha/ui";
import { displayName, type I18n, type ProjectUser } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { ChatRoomController } from "../../../api/controllers/ChatRoomController.ts";
import type {
  ChatRoomAgentResource,
  ChatRoomResource,
} from "../../../schemas/index.ts";
import ChatAgentAvatar from "./ChatAgentAvatar.tsx";
import ChatAgentMark from "./ChatAgentMark.tsx";
import RoomInviteDialog from "./RoomInviteDialog.tsx";

export interface RoomMembersPanelProps {
  room: ChatRoomResource;
  projectId: number;
  me?: string;
  /**
   * `chat:manage`: removes anyone from a private room.
   */
  canManage: boolean;
  users: ProjectUser[];
  members: Array<{ userId: string }>;
  /**
   * The agents that have answered in the room (#Q4268), listed after the
   * people with the badge their messages carry.
   */
  agents?: ChatRoomAgentResource[];
  /**
   * The page's names for the agents it offers, by handle: `@lore`'s own.
   */
  agentLabels?: Record<string, string>;
  onClose: () => void;
}

/**
 * The right column of the Chat page (#E161, #Q3955): who is in the room,
 * with invite (a full-width `+` opening a dialog, #Q4267) and remove on a
 * private one. Nothing else: join, leave,
 * rename and archive are the room row's "..." menu, the notify level the
 * bell in the room's header.
 */
const RoomMembersPanel = (props: RoomMembersPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const rooms = useClient<ChatRoomController>();
  const { room, projectId } = props;
  const params = { projectId, roomId: room.id };
  const invalidates = [
    ["chat-rooms", projectId],
    ["chat-room-members", room.id],
  ];
  const userById = new Map(props.users.map((user) => [user.id, user]));
  const memberIds = new Set(props.members.map((member) => member.userId));
  const manages =
    props.canManage || (!!props.me && room.createdBy === props.me);
  const writable = !room.archivedAt;
  const [inviting, setInviting] = useState(false);

  const invite = useAction<[userId: string], void>(
    {
      handler: async (_context, userId) =>
        void (await rooms.inviteChatRoomMember({ params, body: { userId } })),
      invalidates,
    },
    [rooms, room.id],
  );
  const remove = useAction<[userId: string], void>(
    {
      handler: async (_context, userId) =>
        void (await rooms.removeChatRoomMember({
          params: { ...params, userId },
        })),
      invalidates,
    },
    [rooms, room.id],
  );

  const invitable = props.users.filter((user) => !memberIds.has(user.id));
  const busy = invite.loading || remove.loading;
  // The member whose removal runs: their button spins, the others wait.
  const [removingId, setRemovingId] = useState<string>();
  const count = props.members.length + (props.agents?.length ?? 0);

  return (
    <aside
      aria-label={tr("chat.room.panel")}
      data-testid="chat-room-panel"
      // Chrome, as the room list on the other side: a frame of the
      // conversation, never the page's own background.
      className="chrome flex h-full min-h-0 flex-col overflow-y-auto border-l"
    >
      {/* The twin of the room list's and the conversation's headers. */}
      <div className="flex h-[46px] shrink-0 items-center justify-between border-b pr-2 pl-4">
        <h2 className="text-sm font-semibold">
          {tr("chat.room.members")} ({count})
        </h2>
        <Button
          variant="minimal"
          size="icon-xs"
          aria-label={tr("chat.room.panel.close")}
          onClick={props.onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <ul className="flex flex-col gap-1.5" data-testid="chat-room-members">
          {props.members.map((member) => {
            const user = userById.get(member.userId);
            return (
              <li
                key={member.userId}
                className="flex items-center gap-2 text-sm"
              >
                <UserAvatar public user={user} alt="" className="size-6" />
                <span className="min-w-0 flex-1 truncate">
                  {displayName(user, tr("chat.message.removedMember"))}
                </span>
                {room.private &&
                  manages &&
                  member.userId !== props.me &&
                  writable && (
                    <Button
                      variant="minimal"
                      size="xs"
                      disabled={busy}
                      loading={remove.loading && removingId === member.userId}
                      onClick={() => {
                        setRemovingId(member.userId);
                        void remove
                          .run(member.userId)
                          .finally(() => setRemovingId(undefined));
                      }}
                    >
                      {tr("chat.room.remove")}
                    </Button>
                  )}
              </li>
            );
          })}
          {props.agents?.map((agent) => {
            const name =
              agent.name ?? props.agentLabels?.[agent.handle] ?? agent.handle;
            return (
              <li
                key={agent.agentId ?? agent.handle}
                data-testid="chat-room-agent"
                className="flex items-center gap-2 text-sm"
              >
                <ChatAgentAvatar
                  name={name}
                  avatarId={agent.avatarId}
                  builtin={!agent.agentId}
                  className="size-6 rounded-md"
                />
                <span className="min-w-0 truncate">{name}</span>
                <ChatAgentMark />
                <span className="flex-1" />
              </li>
            );
          })}
        </ul>

        {room.private && room.joined && writable && invitable.length > 0 && (
          <>
            <Button
              variant="outlined"
              size="sm"
              className="w-full"
              aria-label={tr("chat.room.invite")}
              title={tr("chat.room.invite")}
              data-testid="chat-room-invite"
              disabled={busy}
              onClick={() => setInviting(true)}
            >
              <Plus className="size-4" />
            </Button>
            <RoomInviteDialog
              open={inviting}
              onOpenChange={setInviting}
              invitable={invitable}
              busy={busy}
              onInvite={async (userId) => (await invite.run(userId)).ok}
            />
          </>
        )}
      </div>
    </aside>
  );
};

export default RoomMembersPanel;
