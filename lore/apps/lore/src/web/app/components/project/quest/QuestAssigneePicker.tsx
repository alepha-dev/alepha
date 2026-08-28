import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, UserMinus } from "lucide-react";
import { useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { useProjectUsers } from "../../shared/useProjectUsers.ts";
import { UserAvatar } from "../../shared/UserAvatar.tsx";

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
  const toaster = useToast();
  const [pending, setPending] = useState(false);
  // Unconditionally, unlike the read-only row this replaces: the picker has
  // to list everyone, not just resolve the current holder.
  const users = useProjectUsers(true);

  const assignee = quest.acceptedBy
    ? users.find((u) => u.id === quest.acceptedBy)
    : undefined;

  const assign = async (userId: string) => {
    if (userId === quest.acceptedBy) return;
    setPending(true);
    try {
      props.onUpdate(
        await questApi.assignQuest({
          params: { id: quest.id },
          body: { userId },
        }),
      );
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const label = quest.acceptedBy
    ? displayName(assignee, quest.acceptedBy)
    : tr("quest.rail.assign.unassigned");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending || users.length === 0}
        data-testid="quest-assignee-picker"
        className="hover:bg-muted -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 disabled:opacity-60"
      >
        {quest.acceptedBy ? (
          <UserAvatar
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
            onClick={() => void assign(member.id)}
          >
            <UserAvatar
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
