import { $atom, type Infer, z } from "alepha";

/**
 * Persisted UI state — color mode, theme palette, sidebar collapsed state, etc.
 *
 * The atom is bound to a single `alepha-ui` cookie via {@link UiPersistence},
 * so values survive page reloads and are available during SSR.
 */
export const uiAtom = $atom({
  name: "alepha.react.ui",
  schema: z.object({
    /** Color mode preference. `"system"` follows the OS-level setting. */
    mode: z.enum(["light", "dark", "system"]),
    /** Theme palette name. UI consumers map this to a CSS class on the root. */
    theme: z.string(),
    /** Sidebar UI state. */
    sidebar: z.object({
      collapsed: z.boolean(),
    }),
  }),
  default: {
    mode: "system",
    theme: "default",
    sidebar: { collapsed: false },
  },
});

export type UiState = Infer<typeof uiAtom.schema>;
