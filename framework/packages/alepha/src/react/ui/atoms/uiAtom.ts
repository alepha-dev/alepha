import { $atom, type Infer, z } from "alepha";

/**
 * Persisted UI state: color mode, theme palette, vision mode, sidebar
 * collapsed state, etc.
 *
 * The atom is bound to a single `alepha-ui` cookie via {@link UiPersistence},
 * so values survive page reloads and are available during SSR.
 */
export const uiAtom = $atom({
  name: "alepha.react.ui",
  schema: z.object({
    /**
     * Color mode preference. `"system"` follows the OS-level setting.
     */
    mode: z.enum(["light", "dark", "system"]),
    /**
     * Theme palette name. UI consumers map this to a CSS class on the root.
     */
    theme: z.string(),
    /**
     * Vision mode, independent of `mode` and `theme`: `"cvd"` (colour vision
     * deficiency) swaps the meaning-carrying colours for a colour-blind-safe
     * palette, through the `cvd` class on `<html>`.
     *
     * Defaulted in the schema, not only in `default`, so a cookie written
     * before the field existed still validates and reads as `"normal"`
     * instead of being dropped with every other preference in it.
     */
    vision: z.enum(["normal", "cvd"]).default("normal"),
    /**
     * Sidebar UI state.
     */
    sidebar: z.object({
      collapsed: z.boolean(),
    }),
  }),
  default: {
    mode: "system",
    theme: "default",
    vision: "normal",
    sidebar: { collapsed: false },
  },
  // A visitor's preferences: cookie-bound, so personal anyway, said outright.
  personal: true,
});

export type UiState = Infer<typeof uiAtom.schema>;
