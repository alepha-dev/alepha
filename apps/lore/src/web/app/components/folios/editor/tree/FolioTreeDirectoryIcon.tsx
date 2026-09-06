import { Folder, FolderOpen } from "lucide-react";
import type { ReactElement } from "react";

import { resolveDirectoryBadge } from "./folioDirectoryIcons.ts";

export interface FolioTreeDirectoryIconProps {
  name: string;
  isCollapsed: boolean;
}

/**
 * A directory's icon in the folio tree: always the folder, plus a small
 * emblem in its lower-right corner when the name earns one
 * ({@link resolveDirectoryBadge}).
 *
 * The folder is never replaced. It is the one mark that separates a
 * directory from a folio at the size these rows are drawn, and a `trash`
 * folder that stops looking like a folder has traded that away for a hint.
 *
 * ⚠️ The badge sits on an opaque disc that KNOCKS IT OUT of the folder
 * underneath. Without it the badge's strokes cross the folder's own outline
 * and, at 10px, the two read as one smudge rather than as a mark on a
 * folder.
 *
 * ⚠️ That disc tracks the ROW's background across its states, which is why
 * it is not a plain `bg-background`. The row is transparent at rest,
 * `bg-muted/60` on hover and `bg-muted` when selected, so a fixed
 * `--background` disc is a pale dot on every row you point at. The hover
 * value is a `color-mix` rather than `bg-muted/60` because the disc paints
 * ON TOP of a row that has already painted that same 60%: repeating the
 * translucent colour composites it twice and lands darker than its
 * surroundings. Mixing to the opaque equivalent is what actually matches.
 *
 * Known gap: while a drag hovers a directory the row goes `bg-primary/10`
 * and the disc does not follow, because that state lives in the row's props
 * rather than in CSS. It is a light dot for the length of a drag, and
 * threading a fourth state through for that was not worth it.
 *
 * The badge shares the folder's colour token, so the pair reads as one
 * object rather than as a folder with something stuck to it. That is only
 * safe BECAUSE of the disc above: it was `text-primary` while the badge
 * still overlapped the folder's outline directly, where two marks in one
 * colour merge no matter how they are positioned. Remove the disc and the
 * colour has to split again.
 */
const FolioTreeDirectoryIcon = (
  props: FolioTreeDirectoryIconProps,
): ReactElement => {
  const FolderIcon = props.isCollapsed ? Folder : FolderOpen;
  const Badge = resolveDirectoryBadge(props.name);

  return (
    <span
      data-slot="folio-tree-directory-icon"
      className="relative inline-flex size-3.5 shrink-0 items-center justify-center"
    >
      <FolderIcon className="size-3.5 text-[var(--folio-tree-directory)]" />
      {Badge && (
        <span
          aria-hidden
          className="bg-background group-data-[selected]/folio-row:bg-muted absolute -right-0.5 -bottom-0.5 flex size-2.5 items-center justify-center rounded-full group-hover/folio-row:bg-[color-mix(in_oklch,var(--muted)_60%,var(--background))]"
        >
          <Badge
            // ⚠️ `strokeWidth` is not decoration here. Lucide draws a 2px
            // stroke on a 24px canvas; at 8px that scales to 0.67px, which a
            // 1x display renders as a grey smear. 3 keeps it a line.
            strokeWidth={3}
            className="size-2 text-[var(--folio-tree-directory)]"
          />
        </span>
      )}
    </span>
  );
};

export default FolioTreeDirectoryIcon;
