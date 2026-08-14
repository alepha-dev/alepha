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
 */
export const SettingsNav = (props: SettingsNavProps) => {
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
        <div key={group.key} className="flex flex-col gap-1">
          {group.label ? (
            <span className="px-3 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
              {group.label}
            </span>
          ) : null}
          {group.items.map((item) =>
            item.disabled ? (
              <span
                key={item.name}
                aria-disabled="true"
                className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-muted-foreground/50 text-sm"
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
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors",
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
