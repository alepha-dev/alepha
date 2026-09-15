import { Badge, Progress } from "@alepha/ui";
import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
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
      label: tr("epic.aside.number"),
      copy: formatReference("epic", props.epic.number),
    },
    {
      // The name as a row rather than as the panel's heading (#Q2352): the
      // heading truncated a long title with an ellipsis, and a row's value
      // wraps, so the whole name reads.
      label: tr("epic.aside.name"),
      value: (
        <span className="text-sm font-medium break-words">
          {props.epic.title}
        </span>
      ),
    },
    {
      label: tr("epic.aside.status"),
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
    // the API write it). "Blocked by" while it is not completed and this
    // epic's first accept would be refused, "After" once it is; the roadmap
    // keeps "After" throughout, because it draws order and cannot see the
    // predecessor's status.
    ...(props.epic.dependsOnNumber !== undefined
      ? [
          {
            label: tr("epic.aside.predecessor"),
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
      label: tr("epic.aside.release"),
      // A control, not a label. Attaching from the release side is #1559; the
      // epic's own page is where this attachment is actually made, and a row
      // that only reports it would leave the FK writable by nothing but MCP.
      value: <EpicReleaseControl epic={props.epic} onChange={props.onChange} />,
    },
    {
      label: tr("epic.aside.progress"),
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
      label: tr("epic.aside.upNext"),
      value: (
        <span className="text-sm">
          {tr("epic.aside.upNext.value", {
            args: [String(roots), String(props.quests.length - roots)],
          })}
        </span>
      ),
    });

    const areas = [...new Set(props.quests.map((q) => q.area))].sort();
    rows.push({
      label: tr("epic.aside.areas"),
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
    label: tr("epic.aside.lastActivity"),
    value: (
      <span className="text-sm">{dt.of(props.epic.updatedAt).fromNow()}</span>
    ),
  });
  rows.push({
    label: tr("epic.aside.created"),
    value: (
      <span className="text-sm">
        {i18n.l(props.epic.createdAt, { date: "ll" })}
      </span>
    ),
  });

  /*
   * No `title`: the name is the second row, under the ID (#Q2352). The
   * heading `DetailAside` draws truncates to one line, and an epic's name is
   * often a sentence. With no title and `avatar={false}` the component
   * renders no header at all, so the list starts at the top of the panel.
   *
   * `avatar={false}` still: an epic has no picture concept at all, and the
   * letter fallback is for something that HAS one and is missing it.
   */
  return <DetailAside avatar={false} rows={rows} />;
};

export default ProjectEpicAside;
