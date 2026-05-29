import type { PageRoute } from "alepha/react/router";
import type { ReactNode } from "react";

/**
 * Shared helpers for deriving navigation surfaces (sidebar, breadcrumbs,
 * command palette) from the route tree. Each `$page` carries its own `nav`
 * metadata, so there is no separate hand-maintained nav list to keep in sync
 * — see {@link useNavTree} and {@link useNavBreadcrumbs}.
 */

/**
 * Resolve the display label for a page: `nav.label`, then the page `label`,
 * then a static `head.title`, then the route name as a last resort.
 */
export function navLabel(page: PageRoute): ReactNode {
  if (page.nav?.label != null) return page.nav.label;
  if (page.label != null) return page.label;
  const head = page.head;
  // `head` may be a `(props) => Head` function — only a static object carries a
  // usable title here (the nav builder has no props to call it with).
  if (head && typeof head === "object" && "title" in head && head.title) {
    return head.title;
  }
  return page.name;
}

/**
 * Walk the `parent` chain to decide whether `page` is a (strict) descendant of
 * the route named `root`. The root itself is excluded — it anchors the shell
 * but is not a nav entry.
 */
export function isDescendantOf(page: PageRoute, root: string): boolean {
  let parent = page.parent;
  while (parent) {
    if (parent.name === root) return true;
    parent = parent.parent;
  }
  return false;
}

/**
 * AND-semantics permission probe matching `$secure({ permissions })`: a single
 * string requires that one permission; an array requires ALL of them. No
 * permission means "always visible".
 */
export function hasNavPermission(
  permission: string | string[] | undefined,
  has: (permission: string) => boolean,
): boolean {
  if (!permission) return true;
  const list = Array.isArray(permission) ? permission : [permission];
  return list.every(has);
}

/**
 * Whether `current` (the active pathname) is on or under `href`. Mirrors the
 * legacy hand-rolled check — exact match, or a path segment below it — so the
 * sidebar highlights `/admin/users` while viewing `/admin/users/:id`.
 */
export function isActivePath(current: string, href: string): boolean {
  return current === href || current.startsWith(`${href}/`);
}
