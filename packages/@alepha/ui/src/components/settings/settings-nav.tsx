import { cn } from "@alepha/ui/lib/utils";
import { Link } from "alepha/react/router";
import { type ReactNode, useMemo } from "react";

export interface SettingsNavItem {
  /**
   * Stable key. The route name when these come from `useNavEntries`.
   */
  name: string;

  /**
   * Fully resolved href — every `:param` already substituted. See
   * {@link SettingsNav} for why this component refuses to resolve them itself.
   */
  href: string;

  label: ReactNode;
  icon?: ReactNode;

  /**
   * Heading this entry sits under. Entries with no group render first, in a
   * block of their own, without a heading.
   */
  group?: string;

  /**
   * The current route is on or under this entry.
   */
  active: boolean;

  /**
   * Visible but not reachable — rendered muted and inert rather than hidden,
   * so the entry can explain a capability the viewer does not currently have.
   */
  disabled?: boolean;
}

export interface SettingsNavProps {
  /**
   * Entries in final display order. Grouping preserves first appearance, so
   * sort before passing — `useNavEntries` already returns them sorted by
   * group order then item order.
   */
  items: SettingsNavItem[];

  /**
   * Entry height, matching `SidebarMenuButton`'s own sizes: `sm` is `h-7` with
   * `text-xs`, `default` is `h-8` with `text-sm`.
   *
   * @default "sm"
   */
  size?: "sm" | "default";

  className?: string;
}

/**
 * The left-hand rail of a settings page: a sticky, grouped list of links.
 *
 * ⚠️ **It takes resolved `items`, not a `root` route name, and that is the
 * whole design.** Deriving entries internally from `useNavEntries({ root })`
 * would be a smaller API and works fine for a static subtree such as
 * `/account/*` — but `NavEntry.href` is `page.match`, the raw route
 * *pattern*. Point it at a parameterised subtree like
 * `/:projectSlug/settings/...` and every href in the rail comes out
 * containing a literal `:projectSlug`, which is a dead link that renders
 * perfectly.
 *
 * So resolution is the caller's job and presentation is this component's. A
 * static subtree passes `useNavEntries({ root: "account" })` straight through
 * ({@link SettingsNavItem} is structurally a subset of `NavEntry`, so no
 * mapping is needed); a parameterised one passes its own
 * `router.path(name, { params })` list.
 *
 * ### Why this is not built out of `SidebarMenuButton`
 *
 * It reads like the obvious reuse — this rail is a small sidebar, and the
 * sizes and metrics below are deliberately `SidebarMenuButton`'s, so the two
 * look like one family. But the component itself cannot be mounted here:
 *
 * - `SidebarMenuButton` calls `useSidebar()`, which **throws** outside a
 *   `SidebarProvider`. Nothing about a static rail needs that provider — it
 *   exists to hold collapse state — and mounting one to get a button also
 *   registers a global ⌘B handler and starts writing the sidebar cookie. On a
 *   page that already sits inside `AppShell` that is a *second* provider, so
 *   ⌘B would toggle the wrong sidebar.
 * - Making `useSidebar` tolerate a missing provider, or exporting the button's
 *   `cva` to share it, both mean editing `components/ui/sidebar.tsx` — which
 *   `yarn w @alepha/ui sync` overwrites wholesale from the upstream registry.
 *   The patch would vanish on the next refresh, silently.
 *
 * So the metrics are shared by being written the same, and the coupling is
 * not. If the sizes below ever drift from `sidebarMenuButtonVariants`, that is
 * the thing to re-align.
 */
export const SettingsNav = (props: SettingsNavProps) => {
  const size = props.size ?? "sm";

  /*
    `[&_svg]:size-4` is load-bearing, not cosmetic: `useNavEntries` hands over
    `createElement(Icon)` with no className, and a bare lucide icon defaults to
    24px — half again the height of the text it sits next to.
  */
  const entry = cn(
    "flex items-center gap-2 whitespace-nowrap rounded-md px-2 text-left [&_svg]:size-4 [&_svg]:shrink-0",
    size === "sm" ? "h-7 text-xs" : "h-8 text-sm",
  );

  const groups = useMemo(() => {
    const ordered: Array<{ key: string; label?: string }> = [];
    const byKey = new Map<string, SettingsNavItem[]>();

    for (const item of props.items) {
      const key = item.group ?? "";
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = [];
        byKey.set(key, bucket);
        ordered.push({ key, label: item.group });
      }
      bucket.push(item);
    }

    return ordered.map((g) => ({ ...g, items: byKey.get(g.key) ?? [] }));
  }, [props.items]);

  return (
    <nav
      className={cn(
        "flex shrink-0 flex-col gap-4 md:sticky md:top-0 md:w-48 md:self-start",
        props.className,
      )}
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          {group.label ? (
            // `px-2` matches the entries below, so the heading and the labels
            // it heads share a left edge.
            <span className="px-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
              {group.label}
            </span>
          ) : null}
          {group.items.map((item) =>
            item.disabled ? (
              <span
                key={item.name}
                aria-disabled="true"
                className={cn(entry, "text-muted-foreground/50")}
              >
                {item.icon}
                {item.label}
              </span>
            ) : (
              <Link
                key={item.name}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  entry,
                  "transition-colors",
                  item.active
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ),
          )}
        </div>
      ))}
    </nav>
  );
};
