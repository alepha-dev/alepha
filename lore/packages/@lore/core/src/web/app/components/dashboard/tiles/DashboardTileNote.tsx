import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { DashboardCardLink } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface DashboardTileNoteProps {
  /**
   * The owner's markdown, from the card's `filters.markdown`, or what a
   * resolver read (the pinned folio, the Folio card).
   */
  markdown: string;
  /**
   * Where the rest of a note cut short lives: the card shows "Read more"
   * linking there (#Q3520).
   */
  more?: DashboardCardLink;
}

const DashboardTileNote = (props: DashboardTileNoteProps) => {
  const { tr } = useI18n<I18n, "en">();
  // The link's route comes from a resolver, which may be any module's.
  const router = useRouter<any>();
  const more = props.more;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-1">
      <div
        className="min-h-0 w-full flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)] text-[13px]"
        data-testid="tile-note"
      >
        <MarkdownView content={props.markdown} />
      </div>
      {more && (
        // A button, resolving the route on click as the tile rows do: a
        // route the router does not know must not cost the tile its render.
        <button
          type="button"
          onClick={() =>
            void router.push(
              router.path(more.route, {
                params: more.params,
                query: more.query,
              }),
            )
          }
          className={cn(
            textLinkUnderlineClassName,
            "hover:text-foreground self-start text-[12px]",
          )}
        >
          {tr("dashboard.note.read-more")}
        </button>
      )}
    </div>
  );
};

export default DashboardTileNote;
