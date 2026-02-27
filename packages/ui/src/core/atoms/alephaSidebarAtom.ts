import { $atom, type Static, t } from "alepha";

export const alephaSidebarAtom = $atom({
  name: "alepha.ui.sidebar",
  schema: t.object({
    /**
     * Whether the sidebar drawer is closed (mobile).
     */
    closed: t.boolean(),
    /**
     * Whether the sidebar is collapsed (desktop icon-only mode).
     */
    collapsed: t.boolean(),
    /**
     * Width of the sidebar when expanded.
     * @default 300
     */
    expandedWidth: t.number(),
    /**
     * Width of the sidebar when collapsed.
     * @default 78
     */
    collapsedWidth: t.number(),
  }),
  default: {
    closed: true,
    collapsed: false,
    expandedWidth: 300,
    collapsedWidth: 72,
  },
});

export type AlephaSidebarState = Static<typeof alephaSidebarAtom.schema>;
