import { useI18n } from "alepha/react/i18n";

import { loreDocsUrl } from "@/web/app/services/docsUrl.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface ProjectDashboardEmptyProps {
  /**
   * Whether the viewer holds `project:update`.
   *
   * ⚠️ The two readings are genuinely different states, not one message with
   * a disabled button. Somebody who cannot add a card needs to know who can;
   * an empty state whose whole content is an Add button is a dead end for
   * them, and `ProjectRankPresets.CONTRIBUTOR` does not carry the permission,
   * so this is the common case rather than the corner one.
   */
  canEdit: boolean;
  /**
   * Whether any metric is offerable on this project at all.
   *
   * ⚠️ False on a project whose capabilities answer none of them - a
   * Knowledge-only one, most obviously, since all four project-board metrics
   * need Work. Telling that reader to add the first card would be false, and
   * the Add tile they clicked would open a panel with nothing in it.
   */
  hasOfferableMetric: boolean;
}

/**
 * The board before anybody has put anything on it.
 *
 * ⚠️ **This is the project's landing page**, not a corner case. Nothing seeds
 * a project board, so it is the first thing most people see and, on a project
 * with no capability offering a metric, possibly the only thing.
 *
 * A signpost rather than an apology: one line saying what the board is for,
 * the way in already on screen above it (the dashed Add tile stays in the
 * grid), and a link to the page that explains the rest.
 *
 * ⚠️ **It explains none of what the docs page explains.** An empty state is a
 * signpost, not a place to print instructions - so the sharing rule, the
 * permission, the denominators and the absence of a Reset all live behind
 * `loreDocsUrl` and not here.
 */
const ProjectDashboardEmpty = (props: ProjectDashboardEmptyProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div
      data-testid="dashboard-empty"
      className="border-border mt-6 max-w-[560px] rounded-xl border border-dashed p-7"
    >
      <div className="text-sm font-medium">
        {tr("project.dashboard.empty.title")}
      </div>
      <div className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">
        {!props.hasOfferableMetric
          ? tr("project.dashboard.empty.body.noMetrics")
          : props.canEdit
            ? tr("project.dashboard.empty.body")
            : tr("project.dashboard.empty.body.readOnly")}
      </div>
      <a
        // ⚠️ Absolute, through `loreDocsUrl`. Written root-relative it would
        // resolve against Lore's own origin and 404 - feedback #P2142, on the
        // one link that fails exactly when the reader is stuck.
        href={loreDocsUrl("guides-project-dashboard")}
        target="_blank"
        rel="noreferrer"
        data-testid="dashboard-empty-docs"
        className="text-primary mt-3 inline-block text-[12.5px] hover:underline"
      >
        {tr("project.dashboard.empty.docs")}
      </a>
    </div>
  );
};

export default ProjectDashboardEmpty;
