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
 *
 * ⚠️ On its own this over-matches, because it can only see one entry at a time.
 * Run the results through {@link keepDeepestActive} — see there for why.
 */
export function isActivePath(current: string, href: string): boolean {
  return current === href || current.startsWith(`${href}/`);
}

/**
 * Given entries already marked by {@link isActivePath}, keep only the deepest
 * match and clear the rest.
 *
 * `isActivePath` answers "is the current page on or under this entry", which is
 * the right question for a section that owns a subtree — `/admin/users` must
 * stay lit while a user detail page is open. But it is a per-entry predicate,
 * so it cannot tell that a *different* entry matched more specifically.
 *
 * That is not hypothetical. A page at `path: "/"` under a shell contributes no
 * segment of its own, and `ReactPageProvider.createMatch` collapses the result
 * (`/account` + `/` → `/account/` → `/account`), so its `match` comes out
 * **identical to the shell's**. The entry is then a path-prefix of every one of
 * its siblings, and lights up on all of them. `AccountRouter.profile` is
 * exactly this: Profile rendered active on Security, Sessions, API keys,
 * Connected apps and both Lore pages.
 *
 * Deepest-wins rather than a narrower "an index entry must match exactly"
 * rule, because the narrow version breaks the case the loose predicate exists
 * for: an index page that legitimately owns child routes of its own would stop
 * highlighting while one of those children is open. Comparing candidates keeps
 * both behaviours without either needing to know it is an index.
 *
 * Length is a safe proxy for depth here: every candidate is a prefix of the
 * same `current`, so of any two, the longer is under the shorter.
 */
export function keepDeepestActive<T extends { href: string; active: boolean }>(
  entries: T[],
): T[] {
  let deepest = -1;
  for (const entry of entries) {
    if (entry.active && entry.href.length > deepest) {
      deepest = entry.href.length;
    }
  }

  for (const entry of entries) {
    if (entry.active && entry.href.length < deepest) {
      entry.active = false;
    }
  }

  return entries;
}
