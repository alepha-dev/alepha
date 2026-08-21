import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CircleDot,
  Flag,
  Flame,
  GitCommitHorizontal,
  Hourglass,
  Layers,
  Link2,
  MapPin,
  User,
  UserMinus,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentMilestonesAtom } from "@/web/app/atoms/currentMilestonesAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { UserAvatar } from "../../shared/UserAvatar.tsx";
import { useProjectUsers } from "../../shared/useProjectUsers.ts";
import QuestViewDuplicateButton from "./QuestViewDuplicateButton.tsx";
import QuestViewRailRow from "./QuestViewRailRow.tsx";
import QuestViewRailTags from "./QuestViewRailTags.tsx";
import QuestViewSettings from "./QuestViewSettings.tsx";
import QuestViewTimer from "./QuestViewTimer.tsx";
import { formatEstimate } from "./questEstimate.ts";

export interface QuestViewRailProps {
  quest: QuestResource;
  questline: QuestlineSummary;
  onUpdate: (quest: QuestResource) => void;
  onShelve: () => void;
  onUnshelve: () => void;
  onUnassign: () => void;
  shelveDisabled?: boolean;
  unshelveDisabled?: boolean;
  unassignDisabled?: boolean;
}

/**
 * The quest page's metadata rail: what the quest *is*, next to what it says.
 *
 * Every row is read-only except the tags and the reminder — editing goes
 * through the edit drawer, which is one write path with one set of failure
 * states instead of nine inline editors. Rows respect the module gates their
 * value belongs to, because a rail row for a module the project switched off
 * is that module leaking back in. And a row whose data does not exist renders
 * nothing rather than a placeholder waiting for it.
 */
const QuestViewRail = (props: QuestViewRailProps) => {
  const { quest } = props;
  const { tr, l } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);
  const [milestones] = useStore(currentMilestonesAtom);
  const [epic, setEpic] = useState<EpicSummary | undefined>(undefined);

  const features = project?.features;
  const questChronoEnabled = features?.questChrono === true;
  const questReminderEnabled = features?.questReminder === true;
  const questEstimateEnabled = features?.questEstimate === true;
  const epicsEnabled = features?.epics === true;
  const milestonesEnabled = features?.milestones === true;

  // Only fetched when there is a uuid to resolve — the majority of quests in
  // a backlog are unassigned, and the rail must not cost a request each. The
  // Discussion reads the same hook, and `HttpClient` dedupes the two calls.
  const users = useProjectUsers(!!quest.acceptedBy);
  const assignee = quest.acceptedBy
    ? users.find((u) => u.id === quest.acceptedBy)
    : undefined;

  // Same rule for the epic: `quests.epicId` is a global id and the row wants
  // the per-project number and title, which only the epic list carries.
  useEffect(() => {
    if (!project?.id || !quest.epicId || !epicsEnabled) {
      setEpic(undefined);
      return;
    }
    let alive = true;
    epicApi
      .getEpics({ params: { projectId: project.id } })
      .then((epics) => {
        if (alive) setEpic(epics.find((e) => e.id === quest.epicId));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [project?.id, quest.epicId, epicsEnabled]);

  const milestone = quest.milestoneId
    ? milestones?.find((m) => m.id === quest.milestoneId)
    : undefined;

  const statusLabel = {
    new: tr("quest.status.new"),
    accepted: tr("quest.status.accepted"),
    completed: tr("quest.status.completed"),
    shelved: tr("quest.status.shelved"),
  }[quest.metadata.status];

  const questlineParts: string[] = [];
  if (props.questline.predecessor) {
    questlineParts.push(
      tr("quest.view.questline.blockedBy", {
        args: [String(props.questline.predecessor.shortId)],
      }) as string,
    );
  }
  for (const dependent of props.questline.dependents) {
    questlineParts.push(
      tr("quest.view.questline.unlocks", {
        args: [String(dependent.shortId)],
      }) as string,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {questChronoEnabled && (
        <QuestViewTimer quest={quest} onUpdate={props.onUpdate} />
      )}

      <div className="divide-border/60 flex flex-col divide-y">
        <QuestViewRailRow icon={CircleDot} label={tr("board.table.status")}>
          {statusLabel}
        </QuestViewRailRow>

        <QuestViewRailRow icon={User} label={tr("board.table.assigned")}>
          {quest.acceptedBy ? (
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar
                fileId={assignee?.picture}
                className="size-4"
                alt="user avatar"
              />
              {displayName(assignee, quest.acceptedBy)}
            </span>
          ) : undefined}
        </QuestViewRailRow>

        <QuestViewRailRow icon={Flame} label={tr("board.table.priority")}>
          <span className="capitalize">{quest.priority}</span>
        </QuestViewRailRow>

        {questEstimateEnabled && (
          <QuestViewRailRow icon={Hourglass} label={tr("quest.rail.estimate")}>
            {quest.estimateMinutes != null
              ? `~${formatEstimate(quest.estimateMinutes)}`
              : undefined}
          </QuestViewRailRow>
        )}

        <QuestViewRailRow icon={CalendarClock} label={tr("quest.rail.due")}>
          {quest.dueAt
            ? `${l(quest.dueAt, {
                date:
                  dt.of(quest.dueAt).diff(dt.now(), "day") < 7 ? "dddd" : "ll",
              })} · ${dt.of(quest.dueAt).fromNow()}`
            : undefined}
        </QuestViewRailRow>

        <QuestViewRailRow icon={MapPin} label={tr("quest.create.area")}>
          {quest.area || undefined}
        </QuestViewRailRow>

        {epicsEnabled && (
          <QuestViewRailRow icon={Layers} label={tr("quest.rail.epic")}>
            {epic ? (
              <Link
                className="hover:underline"
                href={router.path("projectEpic", {
                  params: {
                    projectSlug: project?.slug ?? "",
                    epicNumber: String(epic.number),
                  },
                })}
              >
                #{epic.number} {epic.title}
              </Link>
            ) : undefined}
          </QuestViewRailRow>
        )}

        {milestonesEnabled && (
          <QuestViewRailRow icon={Flag} label={tr("quest.rail.milestone")}>
            {milestone?.title}
          </QuestViewRailRow>
        )}

        <QuestViewRailRow icon={Link2} label={tr("quest.rail.questline")}>
          {questlineParts.length > 0 ? questlineParts.join(" · ") : undefined}
        </QuestViewRailRow>

        {/* What shipped. No link target: Lore does not know the project's
            repository, and a row that looks clickable and is not is worse
            than a row that does not. */}
        <QuestViewRailRow
          icon={GitCommitHorizontal}
          label={tr("quest.rail.commits")}
        >
          {quest.commits?.length ? (
            <span className="flex flex-col items-end gap-0.5">
              {quest.commits.map((commit) => (
                <span key={commit.sha} className="min-w-0 truncate">
                  <code className="font-mono">{commit.sha.slice(0, 7)}</code>
                  {commit.message ? (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      {commit.message}
                    </span>
                  ) : null}
                </span>
              ))}
            </span>
          ) : undefined}
        </QuestViewRailRow>
      </div>

      <QuestViewRailTags quest={quest} />

      {/* Ruled off from the tags above, the same way the action rows below
          are. Reminder is a control and tags are a readout, so without the
          rule the two blocks ran together as one list. */}
      {questReminderEnabled && !quest.completedAt && (
        <div className="border-t pt-4">
          <QuestViewSettings quest={quest} onUpdate={props.onUpdate} />
        </div>
      )}

      {/* Action rows: the icon is muted and the label is body text, so the
          column reads as a list of verbs rather than a stack of coloured
          glyphs. The destructive row is the exception and tints both, which
          is what makes it the only one that stands out. */}
      {!quest.completedAt && (
        <div className="flex flex-col gap-1.5 border-t pt-4">
          <QuestViewDuplicateButton quest={quest} variant="row" />

          {quest.shelvedAt ? (
            <Button
              type="button"
              variant="ghost"
              className="justify-start gap-3 [&_svg]:text-muted-foreground"
              disabled={props.unshelveDisabled}
              onClick={props.onUnshelve}
            >
              <ArchiveRestore className="size-4" />
              {tr("quest.view.actions.unshelve")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="justify-start gap-3 [&_svg]:text-muted-foreground"
              disabled={props.shelveDisabled}
              onClick={props.onShelve}
            >
              <Archive className="size-4" />
              {tr("quest.view.actions.shelve")}
            </Button>
          )}

          {quest.acceptedAt && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive justify-start gap-3"
              disabled={props.unassignDisabled}
              onClick={props.onUnassign}
            >
              {/* `user-minus`, not a trash can: the server clears the
                  assignee and pushes an `unassigned` event. It has never
                  deleted anything, and the old icon promised it did. */}
              <UserMinus className="size-4" />
              {tr("quest.view.actions.unassign")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The questline as `QuestView` already fetched it — passed down rather than
 * re-fetched, so opening a quest still costs one `getQuestLine`.
 */
export interface QuestlineSummary {
  predecessor?: QuestlineNode;
  dependents: QuestlineNode[];
}

/**
 * One end of a questline link.
 *
 * `completedAt` / `shelvedAt` are what let a reader tell "blocked" from
 * "unblocked" and from "blocked by something parked". They were missing
 * here while `QuestView`'s own state carried them, so anything typed
 * against this interface could not see the difference.
 */
export interface QuestlineNode {
  id: number;
  shortId: number;
  title: string;
  completedAt?: string;
  shelvedAt?: string;
}

interface EpicSummary {
  id: number;
  number: number;
  title: string;
}

export default QuestViewRail;
