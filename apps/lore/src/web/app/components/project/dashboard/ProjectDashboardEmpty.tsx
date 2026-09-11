import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Gauge, Plus } from "lucide-react";

import { loreDocsUrl } from "@/web/app/services/docsUrl.ts";

import type { I18n } from "../../../services/I18n.ts";
import { OutboundLink } from "../../shared/OutboundLink.tsx";

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
   * an Add button would open a catalogue with nothing in it.
   */
  hasOfferableMetric: boolean;
  /**
   * Opens the card catalogue, the same one the header's Add opens once the
   * board has a card.
   */
  onAdd: () => void;
}

/**
 * The board before anybody has put anything on it, and at zero cards the
 * whole page (feedback #P2180).
 *
 * ⚠️ **This is the project's landing page**, not a corner case. Nothing seeds
 * a project board, so it is the first thing most people see and, on a project
 * with no capability offering a metric, possibly the only thing.
 *
 * Shaped like `AlephaTable`'s own empty state - a muted icon, a title, one
 * line and the action - with no dashed frame, and centred on both axes of the
 * content area by its parent. At zero cards the board renders no header and
 * no Add button of its own, so this carries the Add card button; a reader who
 * cannot use it, or a project with nothing a card can count, gets the line
 * that says why and no button.
 *
 * ⚠️ **It explains none of what the docs page explains.** An empty state is a
 * signpost, not a place to print instructions - so the sharing rule, the
 * permission, the denominators and the absence of a Reset all live behind
 * `loreDocsUrl`, as a secondary link under the action.
 */
const ProjectDashboardEmpty = (props: ProjectDashboardEmptyProps) => {
  const { tr } = useI18n<I18n, "en">();
  const canAdd = props.canEdit && props.hasOfferableMetric;

  return (
    <div
      data-testid="dashboard-empty"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center"
    >
      <Gauge className="text-muted-foreground size-8 opacity-40" />
      <p className="text-foreground text-sm font-medium">
        {tr("project.dashboard.empty.title")}
      </p>
      <p className="text-muted-foreground max-w-xs text-sm text-balance">
        {!props.hasOfferableMetric
          ? tr("project.dashboard.empty.body.noMetrics")
          : props.canEdit
            ? tr("project.dashboard.empty.body")
            : tr("project.dashboard.empty.body.readOnly")}
      </p>
      {/* `pt-2` on top of the gap, as `AlephaTable` does it: the action is a
          separate beat from the sentence explaining it. */}
      {canAdd && (
        <div className="pt-2">
          <Button onClick={props.onAdd} data-testid="dashboard-add">
            <Plus />
            {tr("dashboard.addCard")}
          </Button>
        </div>
      )}
      <OutboundLink
        // ⚠️ Absolute, through `loreDocsUrl`. Written root-relative it would
        // resolve against Lore's own origin and 404 - feedback #P2142, on the
        // one link that fails exactly when the reader is stuck.
        href={loreDocsUrl("guides-project-dashboard")}
        data-testid="dashboard-empty-docs"
        className="text-primary mt-1 text-[12.5px] hover:underline"
      >
        {tr("project.dashboard.empty.docs")}
      </OutboundLink>
    </div>
  );
};

export default ProjectDashboardEmpty;
