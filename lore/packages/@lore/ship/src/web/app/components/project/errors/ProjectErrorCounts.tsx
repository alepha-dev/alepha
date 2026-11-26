import { TimeAgo } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";

export interface ProjectErrorCountsProps {
  detail: ProjectErrorDetail;
}

/**
 * The four numbers of an error: how often, in how many apps, since when and
 * until when. The apps figure is left out for an error no app reports (a
 * monitor's outage, a use case run).
 */
const ProjectErrorCounts = (props: ProjectErrorCountsProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const { error, apps, kind } = props.detail;
  return (
    <dl
      className="border-border grid grid-cols-2 gap-x-6 gap-y-3 border-y py-4 sm:grid-cols-4"
      data-testid="error-counts"
    >
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">
          {tr("errors.counts.occurrences")}
        </dt>
        <dd
          className="text-xl font-semibold tabular-nums"
          data-testid="error-count"
        >
          {l(error.count)}
        </dd>
      </div>
      {kind === "sigil" && (
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">
            {tr("errors.counts.apps")}
          </dt>
          <dd className="text-xl font-semibold tabular-nums">
            {l(apps.length)}
          </dd>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">
          {tr("errors.counts.firstSeen")}
        </dt>
        <dd className="text-sm font-medium">
          <TimeAgo value={error.firstSeenAt} />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-xs">
          {tr("errors.counts.lastSeen")}
        </dt>
        <dd className="text-sm font-medium">
          <TimeAgo value={error.lastSeenAt} />
        </dd>
      </div>
    </dl>
  );
};

export default ProjectErrorCounts;
