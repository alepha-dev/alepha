import * as React from "react";

void React;

import type { ComponentType, ReactNode, SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  label: ReactNode;
  /**
   * Required for leaf items. Ignored when `children` is provided (the parent becomes a toggle group).
   */
  href?: string;
  /**
   * Either an icon *component* (e.g. a lucide `Users`) which is instantiated
   * with the row's sizing className, or an already-rendered ReactNode element
   * (e.g. `<Users />`). The latter lets nav metadata declared on a `$page`
   * (which is pure React) carry its icon as a node — see `useNavTree`.
   */
  icon?: IconType | ReactNode;
  /**
   * When provided, renders as the active marker. Compare against current path.
   */
  active?: boolean;
  /**
   * Nested items. When set, the parent becomes a collapsible group.
   */
  children?: NavItem[];
  /**
   * Initial open state for groups. Defaults to true if any descendant is active.
   */
  defaultOpen?: boolean;
  /**
   * Optional trailing badge (e.g. unread count). Hidden when the sidebar is collapsed to icons.
   */
  badge?: ReactNode;
  /**
   * When true the item is rendered muted, navigation is blocked, and the
   * `tooltip` (if any) explains why. Use for paywalled / unavailable entries.
   */
  disabled?: boolean;
  /**
   * Hover tooltip shown on the row regardless of sidebar state. When the
   * item is `disabled`, this is the explanation surface (HoverCard, with
   * room to breathe). When the item is enabled, it surfaces as a regular
   * Tooltip on the trigger.
   */
  tooltip?: ReactNode;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export function hasActiveDescendant(item: NavItem): boolean {
  if (item.active) return true;
  return (item.children ?? []).some(hasActiveDescendant);
}

/**
 * The one open branch of the nav tree, when `navAccordion` is on.
 *
 * A single path rather than a set of open ids, because "one group open" has to
 * mean one group open PER LEVEL: a nested group closing its own parent to open
 * itself would be a bug, not exclusivity. A path says both things at once - a
 * group is open exactly when its path is a prefix of this one, so opening a
 * sibling replaces the path (the sibling closes) while opening a child extends
 * it (the parent stays).
 *
 * Paths are indices into `nav`: `[groupIndex, itemIndex, ...childIndex]`.
 */
export interface NavAccordion {
  openPath: number[];
  setOpenPath: (path: number[]) => void;
}

export function isOpenPathPrefix(path: number[], openPath: number[]): boolean {
  if (path.length === 0 || path.length > openPath.length) return false;
  return path.every((index, depth) => openPath[depth] === index);
}

export function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((index, i) => b[i] === index);
}

/**
 * The path the accordion should be showing: the DEEPEST group holding the
 * active page, or failing that the first group asking for `defaultOpen`.
 *
 * Computed here, from the tree, rather than reported upwards by the item that
 * notices it is active. An item cannot set its parent's state during render
 * (React refuses to update another component mid-render), and doing it in an
 * effect costs a frame of the wrong group being open on every navigation.
 */
export function findOpenPath(nav: NavGroup[]): number[] {
  let fallback: number[] = [];

  const walk = (item: NavItem, path: number[]): number[] | undefined => {
    const children = item.children ?? [];
    if (children.length === 0) return undefined;
    for (let ci = 0; ci < children.length; ci++) {
      const deeper = walk(children[ci]!, [...path, ci]);
      if (deeper) return deeper;
    }
    if (hasActiveDescendant(item)) return path;
    if (fallback.length === 0 && item.defaultOpen) fallback = path;
    return undefined;
  };

  for (let gi = 0; gi < nav.length; gi++) {
    const items = nav[gi]?.items ?? [];
    for (let ii = 0; ii < items.length; ii++) {
      const found = walk(items[ii]!, [gi, ii]);
      if (found) return found;
    }
  }
  return fallback;
}

/**
 * Render a NavItem icon. An already-created element (e.g. `<Users />`, which
 * `React.isValidElement` recognises) is returned as-is; anything else is
 * treated as a component *type* — including lucide's `forwardRef` icons, which
 * are objects rather than plain functions — and instantiated with the row's
 * sizing className.
 */
export function renderNavIcon(
  icon: NavItem["icon"],
  className: string,
): ReactNode {
  if (icon == null || icon === false) return null;
  if (React.isValidElement(icon)) {
    // Already an element (e.g. `<Users />`): clone it to apply the row's sizing
    // className so element icons render at the same size as component icons,
    // merging with any className the caller already set.
    const existing = (icon.props as { className?: string })?.className;
    return React.cloneElement(
      icon as React.ReactElement<{ className?: string }>,
      {
        className: existing ? `${existing} ${className}` : className,
      },
    );
  }
  const Icon = icon as IconType;
  return <Icon className={className} />;
}
