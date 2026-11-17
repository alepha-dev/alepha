import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Flag } from "lucide-react";

import type { RequirementReadiness } from "../../../../api/requirementReadiness.ts";
import ReadinessBar from "./ReadinessBar.tsx";

export interface ReadinessBannerProps {
  release: string;
  readiness: RequirementReadiness;
  /**
   * Plan's `blockFailingMust` is on: publishing is refused while a Must
   * fails.
   */
  blocks: boolean;
}

/**
 * A release's readiness (#E153, #Q3774): Must and Should verified out of
 * all, the failing Musts named, and whether that blocks the publish.
 */
const ReadinessBanner = (props: ReadinessBannerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { readiness } = props;
  return (
    <div
      className="flex flex-col gap-1 rounded-md border p-3 text-sm"
      data-testid="readiness-banner"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <Flag className="size-4" />
          {tr("requirements.trace.readiness", { args: [props.release] })}
        </span>
        <span className="flex items-center gap-2">
          <ReadinessBar {...readiness.must} />
          {tr("requirements.trace.must", {
            args: [
              String(readiness.must.verified),
              String(readiness.must.total),
            ],
          })}
        </span>
        <span className="flex items-center gap-2">
          <ReadinessBar {...readiness.should} />
          {tr("requirements.trace.should", {
            args: [
              String(readiness.should.verified),
              String(readiness.should.total),
            ],
          })}
        </span>
        {readiness.failingMust.length ? (
          <span className="text-danger-text">
            {tr("requirements.trace.failingMust", {
              args: [
                readiness.failingMust
                  .map((it) => formatReference("requirement", it.number))
                  .join(", "),
              ],
            })}
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {tr(
          props.blocks
            ? "requirements.trace.blocking"
            : "requirements.trace.warningOnly",
        )}
      </p>
    </div>
  );
};

export default ReadinessBanner;
