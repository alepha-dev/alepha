import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  UserAvatar,
} from "@alepha/ui";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, UserMinus } from "lucide-react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { useProjectUsers } from "../../shared/useProjectUsers.ts";

export interface QuestAssigneePickerProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

/**
 * Picks who a quest belongs to, from the rail's Assignee row.
 *
 * The rail is deliberately almost read-only — everything else edits through
 * the edit drawer, which keeps one write path with one set of failure
 * states. Assignment is the third exception (after tags and the reminder)
 * because handing work over is the gesture a board exists for: routing it
 * through a drawer would make "give this to someone else" a four-click
 * operation on the surface whose whole point is moving work.
 *
 * Unassign is not here. It already has a button in the rail's action row
 * and its own confirmation, and offering the same destructive verb twice in
 * one panel is how people click the wrong one.
 */
const QuestAssigneePicker = (props: QuestAssigneePickerProps) => {
  const { quest } = props;
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  // Unconditionally, unlike the read-only row this replaces: the picker has
  // to list everyone, not just resolve the current holder.
  const users = useProjectUsers(true);

  const assignee = quest.acceptedBy
    ? users.find((u) => u.id === quest.acceptedBy)
    : undefined;

  // A `useAction` (#E59, #Q2328): a refusal is the server's sentence, toasted
  // by the root `ActionErrorToaster`, and the trigger is disabled meanwhile.
  const assignAction = useAction<[userId: string], void>(
    {
      handler: async (userId) => {
        if (userId === quest.acceptedBy) return;
        props.onUpdate(
          await questApi.assignQuest({
            params: { id: quest.id },
            body: { userId },
          }),
        );
      },
    },
    [questApi, quest.id, quest.acceptedBy, props.onUpdate],
  );
  const pending = assignAction.loading;

  const label = quest.acceptedBy
    ? displayName(assignee, quest.acceptedBy)
    : tr("quest.rail.assign.unassigned");

  return (
    // ⚠️ Deliberately NOT a `Control`, decided with #1703.
    //
    // "Control is the only select, everywhere" is the rule, and the LOOK is
    // no longer the obstacle: `Control` now takes `minimal size="xs"`, which
    // is this trigger's geometry, and the Release row beside it uses exactly
    // that. What stops the swap is the item model. Every row here carries the
    // member's avatar, and `ControlSelect` takes `{ value, label }` - moving
    // this over means either dropping the avatars, which is what makes a
    // people picker scannable, or giving `ControlSelect` a per-item render
    // escape hatch. That second one is a real design question about the whole
    // component and does not belong inside a rail row's quest.
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending || users.length === 0 || !questApi.assignQuest.can()}
        data-testid="quest-assignee-picker"
        className="hover:bg-hover -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 disabled:opacity-60"
      >
        {quest.acceptedBy ? (
          <UserAvatar
            public
            fileId={assignee?.picture}
            className="size-4"
            alt="user avatar"
          />
        ) : (
          <UserMinus className="text-muted-foreground size-4" />
        )}
        <span className="truncate">{String(label)}</span>
        <ChevronDown className="text-muted-foreground size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {users.map((member) => (
          <DropdownMenuItem
            key={member.id}
            data-testid="quest-assignee-option"
            data-user-id={member.id}
            onClick={() => void assignAction.run(member.id)}
          >
            <UserAvatar
              public
              fileId={member.picture}
              className="size-4"
              alt="user avatar"
            />
            <span className="truncate">{displayName(member, member.id)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default QuestAssigneePicker;
