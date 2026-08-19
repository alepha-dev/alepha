import {
  DetailAside,
  type DetailAsideRow,
} from "@alepha/ui/components/detail/detail-aside";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Progress } from "@alepha/ui/components/ui/progress";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { STATUS_BADGE_VARIANT, STATUS_LABEL_KEYS } from "./epicStatus.ts";

export interface ProjectEpicAsideProps {
  epic: EpicResource;
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
  const { completed, total } = props.epic.progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const rows: DetailAsideRow[] = [
    {
      label: String(tr("epic.aside.number")),
      copy: `#${props.epic.number}`,
    },
    {
      label: String(tr("epic.aside.status")),
      value: (
        <Badge variant={STATUS_BADGE_VARIANT[props.epic.status]}>
          {tr(STATUS_LABEL_KEYS[props.epic.status])}
        </Badge>
      ),
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

  // No title and no avatar: the breadcrumb's last segment already names this
  // epic, directly above and a few pixels away, so a heading here printed the
  // same words twice. (An epic has no picture either, which is what made the
  // duplication obvious — dropping the avatar only closed the gap between the
  // two copies.) The rows start at the top edge instead.
  return <DetailAside avatar={false} rows={rows} />;
};

export default ProjectEpicAside;
