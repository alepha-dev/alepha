import { $atom, type Static, t } from "alepha";

/**
 * Persisted UI state — color mode, theme palette, sidebar collapsed state, etc.
 *
 * The atom is bound to a single `alepha-ui` cookie via {@link UiPersistence},
 * so values survive page reloads and are available during SSR.
 */
export const uiAtom = $atom({
  name: "alepha.react.ui",
  schema: t.object({
    /** Color mode preference. `"system"` follows the OS-level setting. */
    mode: t.enum(["light", "dark", "system"]),
    /** Theme palette name. UI consumers map this to a CSS class on the root. */
    theme: t.string(),
    /** Sidebar UI state. */
    sidebar: t.object({
      collapsed: t.boolean(),
    }),
  }),
  default: {
    mode: "system",
    theme: "default",
    sidebar: { collapsed: false },
  },
});

export type UiState = Static<typeof uiAtom.schema>;
