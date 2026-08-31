import { useI18n } from "alepha/react/i18n";

import type { QualityRunResource } from "@/api/schemas/qualityRunSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface ReportsQualityStalenessProps {
  latest: QualityRunResource;
}

/**
 * Where the numbers above came from, and when.
 *
 * ⚠️ The other three Reports tabs need nothing like this, because what they
 * show is recomputed from Lore's own rows on every read: it cannot be stale,
 * only wrong. Quality is a snapshot pushed by a system that can go quiet, and
 * a coverage figure with no date on it is indistinguishable from a current one
 * six months after CI stopped running.
 *
 * Branch and commit are here for the same reason: a run pushed from a topic
 * branch is not the project's coverage, and saying which commit produced the
 * figure is what lets a reader check it.
 */
const ReportsQualityStaleness = (props: ReportsQualityStalenessProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const { latest } = props;

  return (
    <p className="text-muted-foreground text-xs">
      {tr("reports.quality.lastRun", {
        args: [
          // `I18nLocalizeOptions` has `date` and `number` only: a
          // date-and-time reading is a dayjs format string passed to `date`,
          // not a `time` key.
          String(l(latest.createdAt, { date: "lll" })),
          latest.branch,
          latest.commitSha.slice(0, 7),
        ],
      })}
    </p>
  );
};

export default ReportsQualityStaleness;
