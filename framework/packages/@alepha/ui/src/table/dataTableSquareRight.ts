/**
 * From which breakpoint a table's end corners are square (the right ones on
 * a left-to-right page, the left ones on a right-to-left page): `true` for
 * always, or the Tailwind breakpoint at which a panel joins it on that side.
 */
export type DataTableSquareRight = true | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * The classes that square a table's end corners, per breakpoint: `top` for
 * the band that opens the table (the toolbar, or the rows when there is
 * none), `bottom` for the footer.
 *
 * Written out in full rather than built from the breakpoint's name, because
 * Tailwind finds classes by scanning the source for literal strings: a
 * `${breakpoint}:rounded-se-none` assembled at runtime would never be
 * generated.
 */
export const DATA_TABLE_SQUARE_RIGHT: Record<
  `${DataTableSquareRight}`,
  { top: string; bottom: string }
> = {
  true: { top: "rounded-se-none", bottom: "rounded-ee-none" },
  sm: { top: "sm:rounded-se-none", bottom: "sm:rounded-ee-none" },
  md: { top: "md:rounded-se-none", bottom: "md:rounded-ee-none" },
  lg: { top: "lg:rounded-se-none", bottom: "lg:rounded-ee-none" },
  xl: { top: "xl:rounded-se-none", bottom: "xl:rounded-ee-none" },
  "2xl": { top: "2xl:rounded-se-none", bottom: "2xl:rounded-ee-none" },
};
