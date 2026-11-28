import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  UserAvatar,
} from "@alepha/ui";
import { displayName, type I18n, useProjectUsers } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, UserMinus } from "lucide-react";

import type { QuestController } from "../../../../../api/controllers/QuestController.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import QuestAssignee from "../../shared/QuestAssignee.tsx";

export interface QuestAssigneePickerProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
  /**
   * The rail's own Unassign verb: the same `unassignQuest` run, with its
   * confirmation and lifecycle update. Without it, no Unassigned entry.
   */
  onUnassign?: () => void;
  /**
   * Whether that verb is off right now (a write in flight, or no
   * `unassignQuest` permission), exactly as the rail's Unassign row reads it.
   */
  unassignDisabled?: boolean;
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
 * Unassigned is here too, while the quest has an assignee (#Q3758):
 * releasing a quest is the same gesture as handing it over, and scrolling to
 * the rail's action row for it was the complaint. It is not a second
 * implementation: the entry runs the rail's own Unassign (`onUnassign`),
 * with its permission check, its confirmation and its lifecycle update.
 */
const QuestAssigneePicker = (props: QuestAssigneePickerProps) => {
  const { quest } = props;
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  // Unconditionally, unlike the read-only row this replaces: the picker has
  // to list everyone, not just resolve the current holder.
  const users = useProjectUsers(true, { assignable: true });
  // Only those whose rank can work the quest: a viewer of an open project is
  // listed among the members, never offered here (#Q3648).
  const candidates = users.filter((user) => user.assignable !== false);

  const assignee = quest.acceptedBy
    ? users.find((u) => u.id === quest.acceptedBy)
    : undefined;

  // A `useAction` (#E59, #Q2328): a refusal is the server's sentence, toasted
  // by the root `ActionErrorToaster`, and the trigger is disabled meanwhile.
  const assignAction = useAction<[userId: string], void>(
    {
      handler: async (_ctx, userId) => {
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
    //
    // The agent job working it for the member stands in front, linked to
    // the job, outside the trigger: a link inside a button is invalid
    // (#Q4353).
    <QuestAssignee
      quest={quest}
      size="size-4"
      memberName={String(label)}
      member={
        <DropdownMenu>
          {/* `-my-0.5` cancels the `py-0.5` hover pad, as `-mx-1` cancels the
          `px-1`, and `align-top` drops the baseline gap an inline-flex box
          leaves under itself: together they took the row from 34px to the
          rail's 28 (#Q2424). */}
          {/* Not on a draft (#E178): assigning accepts on someone's behalf,
              and the server refuses a quest carrying `draftAt` as it
              refuses Accept. The rail's Mark as ready, or the epic's, comes
              first. */}
          <DropdownMenuTrigger
            disabled={
              pending ||
              candidates.length === 0 ||
              !questApi.assignQuest.can() ||
              !!quest.draftAt
            }
            data-testid="quest-assignee-picker"
            className="hover:bg-hover -mx-1 -my-0.5 inline-flex items-center gap-1.5 rounded px-1 py-0.5 align-top disabled:opacity-60"
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
            {quest.acceptedBy && props.onUnassign && (
              <>
                <DropdownMenuItem
                  data-testid="quest-assignee-unassign"
                  disabled={props.unassignDisabled}
                  onClick={() => props.onUnassign?.()}
                >
                  <UserMinus className="text-muted-foreground size-4" />
                  <span className="truncate">
                    {tr("quest.rail.assign.unassigned")}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {candidates.map((member) => (
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
                <span className="truncate">
                  {displayName(member, member.id)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
};

export default QuestAssigneePicker;
