import { $atom, z } from "alepha";

/**
 * Whether the command palette is open.
 *
 * An atom rather than local state because three components need the same
 * answer and none of them contains the others: the dialog itself is mounted
 * once in `Layout.tsx`, the trigger in the top bar is a sibling of it, and the
 * field in the home hero is several levels below in a different route. The
 * house rule is `$atom` + `useStore` for exactly this, never React context.
 *
 * Not persisted, and it must not be: a palette that reopens itself on the next
 * visit because it was open when the reader left is a bug, not a restored
 * preference.
 */
export const navPaletteAtom = $atom({
  name: "ui.navPalette.open",
  description: "Whether the showcase's command palette is open.",
  schema: z.boolean(),
  default: false,
});
