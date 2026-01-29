import { $atom, type Static, t } from "alepha";

export const alephaSidebarAtom = $atom({
  name: "alepha.ui.sidebar",
  schema: t.object({
    /**
     * Whether the sidebar is opened or closed (mobile).
     */
    opened: t.boolean(),
    /**
     * Whether the sidebar is collapsed (narrow) or expanded (wide).
     */
    collapsed: t.boolean(),
    /**
     * Current width of the sidebar when expanded (can be changed by resizing).
     * @default 300
     */
    width: t.number(),
    /**
     * Default width used when expanding from collapsed state or on hover.
     * @default 300
     */
    defaultWidth: t.number(),
    /**
     * Width of the sidebar when collapsed.
     * @default 78
     */
    collapsedWidth: t.number(),
    /**
     * Maximum width when resizing.
     * @default 500
     */
    maxWidth: t.number(),
    /**
     * Minimum width before auto-collapse triggers.
     * @default 150
     */
    collapseThreshold: t.number(),
    /**
     * Delay in ms before sidebar expands on hover when collapsed.
     * @default 300
     */
    hoverDelay: t.number(),
  }),
  default: {
    opened: false,
    collapsed: false,
    width: 300,
    defaultWidth: 300,
    collapsedWidth: 78,
    maxWidth: 500,
    collapseThreshold: 240,
    hoverDelay: 300,
  },
});

export type AlephaSidebarState = Static<typeof alephaSidebarAtom.schema>;
