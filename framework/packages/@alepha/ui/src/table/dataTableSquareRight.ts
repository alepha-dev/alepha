/**
 * From which breakpoint a table's right corners are square: `true` for
 * always, or the Tailwind breakpoint at which a panel joins it on the right.
 */
export type DataTableSquareRight = true | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * The classes that square a table's right corners, per breakpoint: `top` for
 * the band that opens the table (the toolbar, or the rows when there is
 * none), `bottom` for the footer.
 *
 * Written out in full rather than built from the breakpoint's name, because
 * Tailwind finds classes by scanning the source for literal strings: a
 * `${breakpoint}:rounded-tr-none` assembled at runtime would never be
 * generated.
 */
export const DATA_TABLE_SQUARE_RIGHT: Record<
  `${DataTableSquareRight}`,
  { top: string; bottom: string }
> = {
  true: { top: "rounded-tr-none", bottom: "rounded-br-none" },
  sm: { top: "sm:rounded-tr-none", bottom: "sm:rounded-br-none" },
  md: { top: "md:rounded-tr-none", bottom: "md:rounded-br-none" },
  lg: { top: "lg:rounded-tr-none", bottom: "lg:rounded-br-none" },
  xl: { top: "xl:rounded-tr-none", bottom: "xl:rounded-br-none" },
  "2xl": { top: "2xl:rounded-tr-none", bottom: "2xl:rounded-br-none" },
};
