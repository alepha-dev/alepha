import {
  DetailAside,
  type DetailAsideRow,
} from "@alepha/ui/components/detail/detail-aside";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Progress } from "@alepha/ui/components/ui/progress";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import EpicReleaseControl from "./EpicReleaseControl.tsx";
import {
  epicBlockedBy,
  STATUS_ICONS,
  STATUS_LABEL_KEYS,
  STATUS_TONE,
} from "./epicStatus.ts";

export interface ProjectEpicAsideProps {
  epic: EpicResource;
  /**
   * Applied when the release control writes, so the aside and whatever else
   * holds this epic stay one row.
   */
  onChange: (epic: EpicResource) => void;
  /**
   * The epic's own quests, or `null` while they are still loading. Two rows
   * are derived from them rather than from the epic, so both are omitted on
   * `null` — an aside that says "0 areas" during a fetch is worse than one
   * that says nothing.
   */
  quests: QuestResource[] | null;
}

/**
 * The identity panel of the Epic page: the epic's number, status, progress
 * and shape, as a label/value list.
 *
 * Rows are omitted rather than rendered empty, which is the contract
 * {@link DetailAside} expects of its caller — so a fresh epic with no quests
 * shows four rows, not four rows and three blanks.
 */
const ProjectEpicAside = (props: ProjectEpicAsideProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const dt = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { completed, total } = props.epic.progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const StatusIcon = STATUS_ICONS[props.epic.status];
  const blockedBy = epicBlockedBy(props.epic);

  const rows: DetailAsideRow[] = [
    {
      label: String(tr("epic.aside.number")),
      copy: `#${props.epic.number}`,
    },
    {
      label: String(tr("epic.aside.status")),
      /*
        The same chip the list renders, from the same two tables. Whatever
        an epic looks like in `ProjectEpics` it looks like here, which is
        the reason `epicStatus.ts` exists at all.
      */
      value: (
        <Badge variant="tint" tone={STATUS_TONE[props.epic.status]}>
          <StatusIcon className="size-3" />
          {tr(STATUS_LABEL_KEYS[props.epic.status])}
        </Badge>
      ),
    },
    // The predecessor, which this page never showed before epic #31 made
    // the field a gate (`EpicCreateSheet` has no field for it; only MCP and
    // the API write it). "Blocked by" while it is not done and Begin would
    // be refused, "After" once it is; the roadmap keeps "After" throughout,
    // because it draws order and cannot see the predecessor's status.
    ...(props.epic.dependsOnNumber !== undefined
      ? [
          {
            label: String(tr("epic.aside.predecessor")),
            value: (
              <Link
                href={router.path("projectEpic", {
                  params: { epicNumber: String(props.epic.dependsOnNumber) },
                })}
                className="text-sm underline-offset-4 hover:underline"
              >
                {tr(
                  blockedBy !== undefined
                    ? "epic.aside.predecessor.blocked"
                    : "epic.aside.predecessor.after",
                  { args: [String(props.epic.dependsOnNumber)] },
                )}
              </Link>
            ),
          },
        ]
      : []),
    {
      label: String(tr("epic.aside.release")),
      // A control, not a label. Attaching from the release side is #1559; the
      // epic's own page is where this attachment is actually made, and a row
      // that only reports it would leave the FK writable by nothing but MCP.
      value: <EpicReleaseControl epic={props.epic} onChange={props.onChange} />,
    },
    {
      label: String(tr("epic.aside.progress")),
      value: (
        <div className="flex flex-col gap-1.5">
          <Progress value={pct} />
          <span className="text-muted-foreground text-xs tabular-nums">
            {tr("epic.aside.progress.value", {
              args: [String(completed), String(total)],
            })}
          </span>
        </div>
      ),
    },
  ];

  if (props.quests && props.quests.length > 0) {
    const ids = new Set(props.quests.map((q) => q.id));
    // A root is a quest nothing INSIDE this epic blocks. A `dependsOn`
    // pointing at a quest in another epic still counts as a root here,
    // deliberately: this row describes the epic's own shape, and the flow
    // tab is where an out-of-epic blocker is shown as a stub node.
    const roots = props.quests.filter(
      (q) => q.dependsOn == null || !ids.has(q.dependsOn),
    ).length;
    rows.push({
      label: String(tr("epic.aside.ready")),
      value: (
        <span className="text-sm">
          {tr("epic.aside.ready.value", {
            args: [String(roots), String(props.quests.length - roots)],
          })}
        </span>
      ),
    });

    const areas = [...new Set(props.quests.map((q) => q.area))].sort();
    rows.push({
      label: String(tr("epic.aside.areas")),
      value: (
        <div className="flex flex-wrap gap-1">
          {areas.map((area) => (
            <Badge key={area} variant="secondary" className="font-normal">
              {area}
            </Badge>
          ))}
        </div>
      ),
    });
  }

  rows.push({
    label: String(tr("epic.aside.lastActivity")),
    value: (
      <span className="text-sm">{dt.of(props.epic.updatedAt).fromNow()}</span>
    ),
  });
  rows.push({
    label: String(tr("epic.aside.created")),
    value: (
      <span className="text-sm">
        {String(i18n.l(props.epic.createdAt, { date: "ll" }))}
      </span>
    ),
  });

  /*
   * The epic's name, at the top of the panel, through `DetailAside`'s own
   * `title` slot rather than a heading rendered here: the component owns the
   * type, the truncation and the spacing above its list, and a second way of
   * printing a name is a second way for two asides to disagree.
   *
   * This used to be omitted, on the grounds that the breadcrumb leaf already
   * named the epic a few pixels above and a heading here printed the same
   * words twice. That was true of the old breadcrumb; the leaf is now the
   * epic's `#number`, so the two say different things and neither is
   * redundant. The number stays as a row as well, because that row is not a
   * label but the copy-to-clipboard affordance.
   *
   * `avatar={false}` still: an epic has no picture concept at all, and the
   * letter fallback is for something that HAS one and is missing it, not for
   * printing a title's first character beside the title.
   */
  return <DetailAside avatar={false} title={props.epic.title} rows={rows} />;
};

export default ProjectEpicAside;
