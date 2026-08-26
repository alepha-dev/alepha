import type { PageNav, PageRoute } from "alepha/react/router";
import type { ReactNode } from "react";

/**
 * Shared helpers for deriving navigation surfaces (sidebar, breadcrumbs,
 * command palette) from the route tree. Each `$page` carries its own `nav`
 * metadata, so there is no separate hand-maintained nav list to keep in sync
 * — see {@link useNavTree} and {@link useNavBreadcrumbs}.
 */

/**
 * A page's `nav` metadata plus the catalogue keys the shell resolves for it.
 *
 * The keys live here rather than in the framework's own {@link PageNav}
 * because they mean nothing to the router: `$page` never reads them, and
 * `alepha/react/router` must not learn about i18n to carry a string. Every
 * surface that turns nav metadata into visible text goes through this module,
 * so this is the one place that has to know.
 *
 * A key is optional and additive: `label` stays the English text and is used
 * verbatim when no key is declared, and as the `tr` default when one is — so
 * an application that registers no French catalogue sees exactly what it saw
 * before.
 */
export interface NavMeta extends PageNav {
  /**
   * Catalogue key for {@link PageNav.label}, resolved at render time so the
   * entry follows a language switch.
   *
   * A `$page`'s class field is evaluated once, at construction, outside React
   * — which is why the label cannot simply be `tr(...)` there. Declaring the
   * key instead moves the lookup to {@link navLabel}, which the sidebar,
   * breadcrumbs and command palette all call from inside a component.
   */
  labelKey?: string;

  /**
   * Catalogue key for {@link PageNav.group} — the sidebar section heading.
   *
   * `group` itself stays the untranslated string because it is the grouping
   * KEY: entries are bucketed by it, and two pages in the same section must
   * agree on it in every language. Only the heading is translated.
   *
   * Declared per page, like `group`, rather than once per section: there is no
   * section object to hang it on, and the pair reads as one decision at the
   * call site.
   */
  groupKey?: string;
}

/**
 * Looks up a catalogue key. Structurally `I18nProvider.tr`, redeclared here so
 * this module stays a plain utility — it is called from hooks, which is where
 * the real `tr` comes from.
 */
export type NavTranslate = (
  key: string,
  options?: { default?: string },
) => string;

/**
 * A page's nav metadata, widened to the shell's own {@link NavMeta}.
 *
 * `$page` types `nav` as {@link PageNav} and copies it through untouched, so
 * the extra keys are there at runtime; only the type has to be re-stated.
 */
export function navMeta(page: PageRoute): NavMeta | undefined {
  return page.nav as NavMeta | undefined;
}

/**
 * Resolve the display label for a page: `nav.label`, then the page `label`,
 * then a static `head.title`, then the route name as a last resort.
 *
 * With `tr` and a `nav.labelKey`, the catalogue wins and the chain above
 * becomes the default passed to it — so a missing entry still renders the
 * English text the page declared, never a raw key.
 */
export function navLabel(page: PageRoute, tr?: NavTranslate): ReactNode {
  const fallback = navLabelFallback(page);
  const key = navMeta(page)?.labelKey;
  if (tr && key) {
    return tr(key, {
      // `tr` needs a string; a label declared as an element cannot be one, so
      // the route name stands in — it is what the chain ends on anyway.
      default: typeof fallback === "string" ? fallback : page.name,
    });
  }
  return fallback;
}

function navLabelFallback(page: PageRoute): ReactNode {
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
 * Resolve the sidebar / palette heading for a page's section: the catalogue
 * entry named by `nav.groupKey`, defaulting to `nav.group` itself.
 */
export function navGroupLabel(
  page: PageRoute,
  tr?: NavTranslate,
): string | undefined {
  const nav = navMeta(page);
  if (!nav?.group) return undefined;
  if (tr && nav.groupKey) {
    return tr(nav.groupKey, { default: nav.group });
  }
  return nav.group;
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
