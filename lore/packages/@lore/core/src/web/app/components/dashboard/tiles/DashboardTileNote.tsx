import { MarkdownView } from "@alepha/ui/markdown";

export interface DashboardTileNoteProps {
  /**
   * The owner's markdown, from the card's `filters.markdown`.
   */
  markdown: string;
}

/**
 * A `note` tile: markdown the owner wrote, through the shared `MarkdownView`
 * so it reads like every other piece of markdown in the app.
 */
const DashboardTileNote = (props: DashboardTileNoteProps) => (
  <div
    className="min-h-0 w-full flex-1 overflow-hidden text-[13px]"
    data-testid="tile-note"
  >
    <MarkdownView content={props.markdown} />
  </div>
);

export default DashboardTileNote;
