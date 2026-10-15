import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import type { I18n } from "../../../services/I18n.ts";
import { DashboardHeadline } from "../../dashboard/DashboardHeadline.ts";

export interface ProjectDashboardHeadlineProps {
  cards: DashboardCardResource[];
  values?: DashboardCardValue[];
}

/**
 * The computed board's opening line (#Q2663), assembled by
 * `DashboardHeadline` from the tiles that rendered. Nothing at all when no
 * tile has anything to say.
 */
const ProjectDashboardHeadline = (props: ProjectDashboardHeadlineProps) => {
  const { tr, lang } = useI18n<I18n, "en">();
  const catalog = useInject(DashboardMetricCatalog);
  const builder = useMemo(() => new DashboardHeadline(), []);
  const sentence = builder.build(
    props.cards,
    props.values,
    catalog,
    tr as never,
    lang,
  );

  if (!sentence) return null;
  return (
    <p
      data-testid="dashboard-headline"
      className="max-w-3xl text-[15px] leading-relaxed"
    >
      {sentence}
    </p>
  );
};

export default ProjectDashboardHeadline;
