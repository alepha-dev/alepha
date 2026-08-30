import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { BookMarked, Copy, Download, ScrollText } from "lucide-react";

import type { ReleaseChangelogGroup } from "@/api/schemas/releaseChangelogGroupSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseChangelogRow from "./ReleaseChangelogRow.tsx";

export interface ReleaseChangelogPanelProps {
  groups: ReleaseChangelogGroup[];
  /**
   * `LIVE · N quests` when the release is still recording, `#N · FROZEN
   * <date>` once it has closed. The distinction is the whole point of a
   * release, so it lives in the panel header rather than being implied.
   */
  statusLabel: string;
  live: boolean;
  loading: boolean;
  error: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onSaveToFolio: () => void;
}

/**
 * The changelog itself: an epic heading per attached epic, then the loose
 * quests under the area they were done in, one row each. Rendered from the
 * endpoint's structured `groups` rather than its markdown, so each entry
 * keeps its quest ref and priority.
 */
const ReleaseChangelogPanel = (props: ReleaseChangelogPanelProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-border flex h-12 shrink-0 items-center gap-2.5 border-b px-5 lg:px-7">
        <ScrollText className="text-muted-foreground size-4" />
        <span className="text-[13.5px] font-semibold">
          {tr("release.changelog")}
        </span>
        <span
          className={
            props.live
              ? "rounded-md bg-green-500/15 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-green-600 dark:text-green-400"
              : "bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-medium"
          }
        >
          {props.statusLabel}
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={props.onCopy}>
          <Copy className="size-3.5" />
          {tr("release.changelog.copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={props.onDownload}>
          <Download className="size-3.5" />
          {tr("release.changelog.md")}
        </Button>
        <Button variant="outline" size="sm" onClick={props.onSaveToFolio}>
          <BookMarked className="size-3.5" />
          {tr("release.changelog.saveToFolio")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-8 lg:px-7">
        {props.error ? (
          <p className="text-destructive py-10 text-center text-sm">
            {tr("release.changelog.error")}
          </p>
        ) : props.loading ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {tr("release.changelog.loading")}
          </p>
        ) : props.groups.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm text-pretty">
            {tr("release.changelog.empty")}
          </p>
        ) : (
          props.groups.map((group) => (
            // Keyed on kind AND name: an epic and an area may share a name,
            // and two groups with the same key silently drop one.
            <div key={`${group.kind}:${group.name}`} className="mb-6 last:mb-0">
              <div className="mb-1.5 flex items-center gap-2.5">
                {/* An epic carries its ref; an area has none. The two read as
                    different kinds of heading rather than one list. */}
                {group.kind === "epic" && (
                  <span className="text-muted-foreground font-mono text-[11px] font-medium">
                    #{group.ref}
                  </span>
                )}
                <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-green-600 uppercase dark:text-green-400">
                  {group.name}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {group.questCount}
                </span>
                <div className="bg-border h-px flex-1" />
              </div>
              {group.quests.map((quest) => (
                <ReleaseChangelogRow
                  key={quest.shortId}
                  shortId={quest.shortId}
                  title={quest.title}
                  priority={quest.priority}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ReleaseChangelogPanel;
