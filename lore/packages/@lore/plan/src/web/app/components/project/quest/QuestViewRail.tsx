import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import {
  currentProjectAtom,
  type I18n,
  capabilityOption,
  CommitLink,
  ResourceRailRegistry,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Circle,
  CircleDashed,
  CircleDot,
  Flag,
  Flame,
  GitCommitHorizontal,
  GitPullRequest,
  Hourglass,
  Layers,
  MapPin,
  PauseCircle,
  PlayCircle,
  Ruler,
  User,
  UserMinus,
} from "lucide-react";

import type { EpicController } from "../../../../../api/controllers/EpicController.ts";
import type { PullRequest } from "../../../../../api/schemas/pullRequestSchema.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import PullRequestLinks from "../../shared/PullRequestLinks.tsx";
import QuestAssigneePicker from "./QuestAssigneePicker.tsx";
import { QUEST_STATUS_LABEL_KEYS } from "./questChips.ts";
import { formatEstimate } from "./questEstimate.ts";
import QuestReleaseControl from "./QuestReleaseControl.tsx";
import { formatQuestSize } from "./questSize.ts";
import QuestViewDuplicateButton from "./QuestViewDuplicateButton.tsx";
import QuestViewRailEpicLink from "./QuestViewRailEpicLink.tsx";
import QuestViewRailRow from "./QuestViewRailRow.tsx";
import QuestViewRailSlot from "./QuestViewRailSlot.tsx";
import QuestViewRailTags from "./QuestViewRailTags.tsx";
import QuestViewSettings from "./QuestViewSettings.tsx";
import QuestViewTimer from "./QuestViewTimer.tsx";

export interface QuestViewRailProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
  onShelve: () => void;
  onUnshelve: () => void;
  onHold: () => void;
  onUnhold: () => void;
  onUnassign: () => void;
  onReady: () => void;
  onDraft: () => void;
  shelveDisabled?: boolean;
  unshelveDisabled?: boolean;
  holdDisabled?: boolean;
  unholdDisabled?: boolean;
  unassignDisabled?: boolean;
  readyDisabled?: boolean;
  draftDisabled?: boolean;
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
  const router = useRouter();
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);
  // Rows other modules register for a quest (#E154): Ship's Live row.
  const slots = useInject(ResourceRailRegistry).rows("quest");

  // Every one of these is an option inside Work: a capability that is off
  // reads its options off, which is the epic's narrow-never-widen rule and
  // means a project without Work shows none of this rather than all of it.
  const questChronoEnabled = capabilityOption(project, "plan", "chrono");
  const questReminderEnabled = capabilityOption(project, "plan", "reminder");
  const questEstimateEnabled = capabilityOption(project, "plan", "estimate");
  const epicsEnabled = capabilityOption(project, "plan", "epics");
  const releasesEnabled = capabilityOption(project, "plan", "releases");

  // Same rule for the epic: `quests.epicId` is a global id and the row wants
  // the per-project number and title, which only the epic list carries.
  //
  // A `useQuery` keyed on the project (#E59, #Q2328), so every quest page of
  // one project shares the list. Quiet on failure: the row is a link to the
  // epic, and a quest page without it is still the quest page.
  const epicsQuery = useQuery(
    {
      key: ["epics", project?.id],
      enabled: !!project?.id && !!quest.epicId && epicsEnabled,
      // The refs, not `getEpics`: the row reads a number and a title, and
      // the full list carries every description (#Q3713).
      handler: () =>
        epicApi.getEpicRefs({ params: { projectId: project?.id as number } }),
      onError: () => {},
    },
    [epicApi, project?.id],
  );
  const epic: EpicSummary | undefined =
    quest.epicId && epicsEnabled
      ? epicsQuery.data?.find((e) => e.id === quest.epicId)
      : undefined;

  // The quest's own pull requests, or its epic's when it has none (#Q3707):
  // an epic lands as one pull request, recorded once on the epic, and each
  // of its quests points at it from here. Read off the epic list the Epic
  // row already holds, so it costs no request of its own.
  const ownPullRequests = quest.pullRequests ?? [];
  const pullRequests: PullRequest[] = ownPullRequests.length
    ? ownPullRequests
    : (epic?.pullRequests ?? []);
  const pullRequestsFromEpic =
    ownPullRequests.length === 0 && pullRequests.length > 0;

  const statusLabel = tr(QUEST_STATUS_LABEL_KEYS[quest.metadata.status]);

  // Draft by hand on a loose quest only (#E178): a quest filed under an epic
  // is a draft while its epic is, and the epic is where that changes, so
  // its page offers neither verb and says where to go instead.
  const loose = quest.epicId == null;
  const offerReady = loose && quest.metadata.status === "draft";
  const offerDraft = loose && quest.metadata.status === "todo";
  const draftOfEpic =
    !loose && quest.metadata.status === "draft" ? epic : undefined;

  return (
    <div className="flex flex-col">
      {questChronoEnabled && (
        <QuestViewTimer quest={quest} onUpdate={props.onUpdate} />
      )}

      <div className="divide-border/60 flex flex-col divide-y">
        <QuestViewRailRow icon={CircleDot} label={tr("board.table.status")}>
          {/* The agent job working it is drawn with its assignee (#Q4353). */}
          {statusLabel}
        </QuestViewRailRow>

        {/* The third editable row, after tags and the reminder. Handing
            work over is what a board is for, so it does not go through the
            edit drawer — see `QuestAssigneePicker`. */}
        <QuestViewRailRow icon={User} label={tr("board.table.assigned")}>
          <QuestAssigneePicker
            quest={quest}
            onUpdate={props.onUpdate}
            onUnassign={props.onUnassign}
            unassignDisabled={props.unassignDisabled}
          />
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
              <QuestViewRailEpicLink
                number={epic.number}
                title={epic.title}
                href={router.path("projectEpic", {
                  params: {
                    projectSlug: project?.slug ?? "",
                    epicNumber: String(epic.number),
                  },
                })}
              />
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
                // Linked or not, and why it carries no icon, is `CommitLink`'s
                // to decide, shared with both artifact views (#Q2336).
                const sha = <CommitLink sha={commit.sha} repo={commit.repo} />;

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

        {project?.id != null &&
          slots.map((entry) => (
            <QuestViewRailSlot
              key={entry.key}
              entry={entry}
              subject={{ projectId: project.id, number: quest.shortId }}
            />
          ))}

        <QuestViewRailRow
          icon={GitPullRequest}
          label={tr("quest.rail.pullRequests")}
        >
          {pullRequests.length ? (
            <span className="flex min-w-0 flex-col items-end gap-0.5">
              <PullRequestLinks pullRequests={pullRequests} />
              {pullRequestsFromEpic && (
                <span className="text-muted-foreground text-xs">
                  {tr("quest.rail.pullRequests.fromEpic")}
                </span>
              )}
            </span>
          ) : undefined}
        </QuestViewRailRow>
      </div>

      <QuestViewRailTags quest={quest} onUpdate={props.onUpdate} />

      {/* Ruled off from the tags above, the same way the action rows below
          are: reminder is a control and tags are a readout. The rule is the
          component's own, since it renders nothing on a quest nobody has
          accepted. */}
      {questReminderEnabled && !quest.completedAt && (
        <QuestViewSettings quest={quest} onUpdate={props.onUpdate} />
      )}

      {/* Action rows: the icon is muted and the label is body text, so the
          column reads as a list of verbs rather than a stack of coloured
          glyphs. The destructive row is the exception and tints both, which
          is what makes it the only one that stands out. */}
      {!quest.completedAt && (
        <div className="flex flex-col gap-1.5 border-t pt-4">
          <QuestViewDuplicateButton quest={quest} />

          {offerReady && (
            <Button
              type="button"
              variant="minimal"
              className="[&_svg]:text-muted-foreground justify-start gap-3"
              disabled={props.readyDisabled}
              onClick={props.onReady}
            >
              <Circle className="size-4" />
              {tr("quest.view.actions.markReady")}
            </Button>
          )}

          {offerDraft && (
            <Button
              type="button"
              variant="minimal"
              className="[&_svg]:text-muted-foreground justify-start gap-3"
              disabled={props.draftDisabled}
              onClick={props.onDraft}
            >
              <CircleDashed className="size-4" />
              {tr("quest.view.actions.markDraft")}
            </Button>
          )}

          {/* In the verbs' place, the way to the one that applies: the
              epic's own Mark as ready. A line, not a button, so it does not
              read as an action this quest has. */}
          {draftOfEpic && (
            <Link
              href={router.path("projectEpic", {
                params: {
                  projectSlug: project?.slug ?? "",
                  epicNumber: String(draftOfEpic.number),
                },
              })}
              title={draftOfEpic.title}
              data-testid="quest-draft-epic"
              className="text-muted-foreground hover:text-foreground flex items-center gap-3 px-2.5 py-1.5 text-sm"
            >
              <CircleDashed className="size-4 shrink-0" />
              {tr("quest.view.draft.epic", {
                args: [String(draftOfEpic.number)],
              })}
            </Link>
          )}

          {quest.heldAt ? (
            <Button
              type="button"
              variant="minimal"
              className="[&_svg]:text-muted-foreground justify-start gap-3"
              disabled={props.unholdDisabled}
              onClick={props.onUnhold}
            >
              <PlayCircle className="size-4" />
              {tr("quest.view.actions.unhold")}
            </Button>
          ) : (
            // Not offered on a shelved quest: `holdQuest` accepts `todo` and
            // `in_progress` only, and a quest already set aside as out of scope
            // is not waiting for anything. Nor on a draft (#E178), which is
            // not ready, so not waiting on anything either: refused on
            // `draftAt`, as the server does.
            !quest.shelvedAt &&
            !quest.draftAt && (
              <Button
                type="button"
                variant="minimal"
                className="[&_svg]:text-muted-foreground justify-start gap-3"
                disabled={props.holdDisabled}
                onClick={props.onHold}
              >
                <PauseCircle className="size-4" />
                {tr("quest.view.actions.hold")}
              </Button>
            )
          )}

          {quest.shelvedAt ? (
            <Button
              type="button"
              variant="minimal"
              className="[&_svg]:text-muted-foreground justify-start gap-3"
              disabled={props.unshelveDisabled}
              onClick={props.onUnshelve}
            >
              <ArchiveRestore className="size-4" />
              {tr("quest.view.actions.unshelve")}
            </Button>
          ) : (
            // Shelving is refused while held - it would have to clear the
            // hold, and clearing one is an explicit act, not a side effect
            // of another verb. Hiding the row says so before the 400 does.
            !quest.heldAt && (
              <Button
                type="button"
                variant="minimal"
                className="[&_svg]:text-muted-foreground justify-start gap-3"
                disabled={props.shelveDisabled}
                onClick={props.onShelve}
              >
                <Archive className="size-4" />
                {tr("quest.view.actions.shelve")}
              </Button>
            )
          )}

          {quest.acceptedAt && (
            <Button
              type="button"
              variant="minimal"
              className="text-danger-text hover:text-danger-text justify-start gap-3"
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
  pullRequests?: PullRequest[];
}

export default QuestViewRail;
