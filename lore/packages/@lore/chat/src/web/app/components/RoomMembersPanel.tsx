import { Button, UserAvatar } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { displayName, type I18n, type ProjectUser } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

import type { ChatMessageController } from "../../../api/controllers/ChatMessageController.ts";
import type { ChatRoomController } from "../../../api/controllers/ChatRoomController.ts";
import type { ChatRoomResource } from "../../../schemas/index.ts";
import { roomInviteFormSchema } from "../schemas/roomInviteFormSchema.ts";
import { roomNotifyFormSchema } from "../schemas/roomNotifyFormSchema.ts";
import { roomRenameFormSchema } from "../schemas/roomRenameFormSchema.ts";

export interface RoomMembersPanelProps {
  room: ChatRoomResource;
  projectId: number;
  me?: string;
  /**
   * `chat:manage`: renames and archives any room, removes anyone.
   */
  canManage: boolean;
  users: ProjectUser[];
  members: Array<{ userId: string }>;
  onClose: () => void;
  onRenamed: (room: ChatRoomResource) => void;
}

/**
 * The right column of the Chat page (#E161, #Q3955): who is in the room,
 * and what the reader may do about it. Invite and remove on a private room,
 * join and leave on an open one, the reader's notify level, and rename and
 * archive for the room's creator or `chat:manage`.
 */
const RoomMembersPanel = (props: RoomMembersPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const rooms = useClient<ChatRoomController>();
  const messages = useClient<ChatMessageController>();
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

  const join = useAction<[], void>(
    {
      handler: async () => void (await rooms.joinChatRoom({ params })),
      invalidates,
    },
    [rooms, room.id],
  );
  const leave = useAction<[], void>(
    {
      handler: async () => void (await rooms.leaveChatRoom({ params })),
      invalidates,
    },
    [rooms, room.id],
  );
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
  const archive = useAction<[], void>(
    {
      handler: async () =>
        void (room.archivedAt
          ? await rooms.unarchiveChatRoom({ params })
          : await rooms.archiveChatRoom({ params })),
      invalidates,
    },
    [rooms, room.id, room.archivedAt],
  );
  const rename = useAction<[name: string], void>(
    {
      handler: async (_context, name) => {
        const renamed = await rooms.renameChatRoom({ params, body: { name } });
        props.onRenamed(renamed);
      },
      invalidates,
    },
    [rooms, room.id, props.onRenamed],
  );
  const notify = useAction<[level: "mentions" | "muted"], void>(
    {
      handler: async (_context, level) =>
        void (await messages.setChatRoomNotifyLevel({
          params,
          body: { level },
        })),
      invalidates,
    },
    [messages, room.id],
  );

  const inviteForm = useForm(
    {
      schema: roomInviteFormSchema,
      initialValues: { userId: undefined },
      handler: async (values) => {
        if (values.userId) await invite.run(values.userId);
      },
    },
    [room.id, props.members.length],
  );
  const notifyForm = useForm(
    {
      schema: roomNotifyFormSchema,
      initialValues: { level: room.notifyLevel ?? "mentions" },
      handler: async () => {},
      // Saved as it changes: there is no Save button for one choice.
      onChange: (_key, value) => {
        if (value === "mentions" || value === "muted") void notify.run(value);
      },
    },
    [room.id],
  );
  const renameForm = useForm(
    {
      schema: roomRenameFormSchema,
      initialValues: { name: room.name },
      handler: async (values) => {
        await rename.run(values.name);
      },
    },
    [room.id, room.name],
  );

  const invitable = props.users.filter((user) => !memberIds.has(user.id));
  const busy =
    join.loading ||
    leave.loading ||
    invite.loading ||
    remove.loading ||
    archive.loading ||
    rename.loading;

  return (
    <aside
      aria-label={tr("chat.room.panel")}
      data-testid="chat-room-panel"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto border-l p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {tr("chat.room.members")} ({props.members.length})
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

      <ul className="flex flex-col gap-1.5" data-testid="chat-room-members">
        {props.members.map((member) => {
          const user = userById.get(member.userId);
          return (
            <li key={member.userId} className="flex items-center gap-2 text-sm">
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
                    onClick={() => void remove.run(member.userId)}
                  >
                    {tr("chat.room.remove")}
                  </Button>
                )}
            </li>
          );
        })}
      </ul>

      {room.private && room.joined && writable && invitable.length > 0 && (
        <form {...inviteForm.props} className="flex items-end gap-2">
          <Control
            input={inviteForm.input.userId}
            label={tr("chat.room.invite")}
            select
            triggerClassName="w-full"
            items={invitable.map((user) => ({
              value: user.id,
              label: displayName(user),
            }))}
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={busy}>
            {tr("chat.room.invite.submit")}
          </Button>
        </form>
      )}

      {!room.private &&
        !room.joined &&
        writable &&
        rooms.joinChatRoom.can() && (
          <Button size="sm" disabled={busy} onClick={() => void join.run()}>
            {tr("chat.room.join")}
          </Button>
        )}

      {room.joined && (
        <>
          <Control
            input={notifyForm.input.level}
            label={tr("chat.room.notify")}
            select
            triggerClassName="w-full"
            items={[
              { value: "mentions", label: tr("chat.room.notify.mentions") },
              { value: "muted", label: tr("chat.room.notify.muted") },
            ]}
          />
          <Button
            variant="outlined"
            size="sm"
            disabled={busy}
            onClick={() => void leave.run()}
          >
            {tr("chat.room.leave")}
          </Button>
        </>
      )}

      {manages && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <form {...renameForm.props} className="flex items-end gap-2">
            <Control
              input={renameForm.input.name}
              label={tr("chat.room.rename")}
              disabled={busy || !writable}
            />
            <Button type="submit" size="sm" disabled={busy || !writable}>
              {tr("chat.room.rename.submit")}
            </Button>
          </form>
          <Button
            variant="outlined"
            size="sm"
            disabled={busy}
            onClick={() => void archive.run()}
          >
            {room.archivedAt
              ? tr("chat.room.unarchive")
              : tr("chat.room.archive")}
          </Button>
        </div>
      )}
    </aside>
  );
};

export default RoomMembersPanel;
