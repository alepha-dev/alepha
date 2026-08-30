import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { ChevronRight, History, Trash } from "lucide-react";

import type { Release } from "@/api/entities/releases.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseClosedRailProps {
  releases: Release[];
  onOpenDetail: (release: Release) => void;
  onDelete: (id: number) => void;
}

/**
 * Closed releases, newest first. Each row opens the detail sheet — the
 * only place a release's title, notes and tags can still be edited now
 * that the page has no detail pane of its own.
 */
const ReleaseClosedRail = (props: ReleaseClosedRailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex h-12 shrink-0 items-center gap-2 border-y px-5">
        <History className="text-muted-foreground size-4" />
        <span className="text-[13.5px] font-semibold">
          {tr("release.ledger.closed")}
        </span>
        <span className="text-muted-foreground text-xs">
          {props.releases.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.releases.length === 0 ? (
          <p className="text-muted-foreground px-5 py-6 text-center text-xs text-pretty">
            {tr("release.history.empty")}
          </p>
        ) : (
          props.releases.map((release) => (
            <div
              key={release.id}
              role="button"
              tabIndex={0}
              onClick={() => props.onOpenDetail(release)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onOpenDetail(release);
                }
              }}
              className="group border-border/60 hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-5 py-3 text-left transition-colors"
            >
              <span className="bg-muted flex size-6.5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold">
                {release.number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {release.title}
                </div>
                <div className="text-muted-foreground mt-0.5 text-[11.5px]">
                  {tr("release.ledger.closed.meta", {
                    args: [
                      String(
                        release.closedAt
                          ? i18n.l(release.closedAt, { date: "ll" })
                          : "",
                      ),
                    ],
                  })}
                </div>
              </div>
              {/* Offered on every row now. The button used to be hidden
                  unless the release had caught no quests, because the API
                  refused to delete one whose time window had recorded any.
                  Deleting is cheap again: `quests.releaseId` is
                  `ON DELETE SET NULL`, so nothing is lost but the row. */}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive size-7 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete(release.id);
                }}
                aria-label={String(tr("release.delete"))}
              >
                <Trash className="size-3.5" />
              </Button>
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ReleaseClosedRail;
