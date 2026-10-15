/**
 * One slot of the board's backdrop, on the tiles' own tracks.
 *
 * Two marks, both on the slot rather than inside it:
 *
 * - **A rule through the gutter**, on the slot's top and left edges pushed
 *   out by half the grid gap (`-inset-1.5` against `gap-3`). Neighbouring
 *   slots meet on the same line, so the rules form one continuous grid that
 *   runs down the middle of every gutter: the board reads as a sheet ruled
 *   for its tiles, not as boxes waiting to be filled.
 * - **Crop marks at the slot's four corners.** A tile's corner is rounder
 *   than a mark's, so on a filled slot the mark shows just outside the tile's
 *   curve, a second corner around it; on an empty one they say where a tile
 *   would land.
 *
 * Drawn in the theme's `--border` and `--muted-foreground`, so dark mode
 * needs no copy.
 */
const DashboardGridBackdropCell = () => (
  <div className="relative">
    <span className="border-border/25 absolute -inset-1.5 border-t border-l" />
    <span className="border-muted-foreground/35 absolute top-0 left-0 size-3 rounded-tl-md border-t border-l" />
    <span className="border-muted-foreground/35 absolute top-0 right-0 size-3 rounded-tr-md border-t border-r" />
    <span className="border-muted-foreground/35 absolute bottom-0 left-0 size-3 rounded-bl-md border-b border-l" />
    <span className="border-muted-foreground/35 absolute right-0 bottom-0 size-3 rounded-br-md border-r border-b" />
  </div>
);

export default DashboardGridBackdropCell;
