import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
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
  MapPin,
  Ruler,
  User,
  UserMinus,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
import QuestAssigneePicker from "./QuestAssigneePicker.tsx";
import { formatEstimate } from "./questEstimate.ts";
import QuestReleaseControl from "./QuestReleaseControl.tsx";
import { formatQuestSize } from "./questSize.ts";
import QuestViewDuplicateButton from "./QuestViewDuplicateButton.tsx";
import QuestViewRailRow from "./QuestViewRailRow.tsx";
import QuestViewRailTags from "./QuestViewRailTags.tsx";
import QuestViewSettings from "./QuestViewSettings.tsx";
import QuestViewTimer from "./QuestViewTimer.tsx";

export interface QuestViewRailProps {
  quest: QuestResource;
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
 * Every row is read-only except the tags, the reminder and the release —
 * editing goes through the edit drawer, which is one write path with one set
 * of failure states instead of nine inline editors. The release is an
 * exception on purpose: it is a scheduling decision made while reading the
 * quest, not while rewriting it, and the drawer is the wrong place for a
 * question you answer about six quests in a row. Rows respect the module gates their
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
  const [epic, setEpic] = useState<EpicSummary | undefined>(undefined);

  const features = project?.features;
  const questChronoEnabled = features?.questChrono === true;
  const questReminderEnabled = features?.questReminder === true;
  const questEstimateEnabled = features?.questEstimate === true;
  const epicsEnabled = features?.epics === true;
  const releasesEnabled = features?.milestones === true;

  // Same rule for the epic: `quests.epicId` is a global id and the row wants
  // the per-project number and title, which only the epic list carries.
  useEffect(() => {
    if (!project?.id || !quest.epicId || !epicsEnabled) {
      // Early return of the epic fetch below.
      // oxlint-disable-next-line react/set-state-in-effect
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

  const statusLabel = {
    new: tr("quest.status.new"),
    accepted: tr("quest.status.accepted"),
    completed: tr("quest.status.completed"),
    shelved: tr("quest.status.shelved"),
  }[quest.metadata.status];

  return (
    <div className="flex flex-col gap-4">
      {questChronoEnabled && (
        <QuestViewTimer quest={quest} onUpdate={props.onUpdate} />
      )}

      <div className="divide-border/60 flex flex-col divide-y">
        <QuestViewRailRow icon={CircleDot} label={tr("board.table.status")}>
          {statusLabel}
        </QuestViewRailRow>

        {/* The third editable row, after tags and the reminder. Handing
            work over is what a board is for, so it does not go through the
            edit drawer — see `QuestAssigneePicker`. */}
        <QuestViewRailRow icon={User} label={tr("board.table.assigned")}>
          <QuestAssigneePicker quest={quest} onUpdate={props.onUpdate} />
        </QuestViewRailRow>

        <QuestViewRailRow icon={Flame} label={tr("board.table.priority")}>
          <span className="capitalize">{quest.priority}</span>
        </QuestViewRailRow>

        {/* Directly under Priority, mirroring the create form where the two
            share a row. Ungated: unlike Estimate, size is mandatory, so
            there is always a value to show. */}
        <QuestViewRailRow icon={Ruler} label={tr("quest.rail.size")}>
          {formatQuestSize(quest.size) || undefined}
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
                  Math.abs(dt.of(quest.dueAt).diff(dt.now(), "day")) < 7
                    ? "dddd"
                    : "ll",
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
                {formatReference("epic", epic.number)} {epic.title}
              </Link>
            ) : undefined}
          </QuestViewRailRow>
        )}

        {releasesEnabled && (
          <QuestViewRailRow icon={Flag} label={tr("quest.rail.release")}>
            <QuestReleaseControl quest={quest} onUpdate={props.onUpdate} />
          </QuestViewRailRow>
        )}

        {/* What shipped. The sha links into the project's repository when the
            owner has set one on the General settings page, and renders as
            plain text when they have not - a row that looks clickable and is
            not is worse than a row that does not (quest #1571).

            `/commit/<sha>` is correct on GitHub and Gitea, and GitLab
            redirects it to `/-/commit/`, which is why there is no provider
            setting to go with the URL.

            ⚠️ Built from the PROJECT, not from `commit.repo`. That field is
            still stored and still accepted over MCP, because existing rows
            carry it, but one project is one repository (2026-08-29) and two
            sources for one link is how they drift. */}
        <QuestViewRailRow
          icon={GitCommitHorizontal}
          label={tr("quest.rail.commits")}
        >
          {quest.commits?.length ? (
            // Short codes wrapping right-aligned, so two or three commits
            // share a line instead of taking one each.
            //
            // The message used to sit beside the sha, truncated (#1574). The
            // rail is a narrow column and a conventional-commit subject never
            // fits, so what survived the clip was the type and the scope -
            // the least informative part of it. It is a tooltip now (#1701):
            // the sha is the identifier, the message is the detail, and the
            // detail is one hover away rather than four words wide.
            <span className="flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-0.5">
              {quest.commits.map((commit) => {
                const short = commit.sha.slice(0, 7);
                const sha = project?.repositoryUrl ? (
                  <a
                    href={`${project.repositoryUrl}/commit/${commit.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono underline-offset-2 hover:underline"
                  >
                    {short}
                  </a>
                ) : (
                  <code className="font-mono">{short}</code>
                );

                // `quest_commit_add` accepts a bare sha, so a tooltip with
                // nothing in it is a real case rather than a defensive one.
                if (!commit.message) {
                  return <span key={commit.sha}>{sha}</span>;
                }

                return (
                  <Tooltip key={commit.sha}>
                    <TooltipTrigger render={<span>{sha}</span>} />
                    <TooltipContent className="max-w-xs text-left">
                      {commit.message}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
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
          <QuestViewDuplicateButton quest={quest} />

          {quest.shelvedAt ? (
            <Button
              type="button"
              variant="ghost"
              className="[&_svg]:text-muted-foreground justify-start gap-3"
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
              className="[&_svg]:text-muted-foreground justify-start gap-3"
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

interface EpicSummary {
  id: number;
  number: number;
  title: string;
}

export default QuestViewRail;
