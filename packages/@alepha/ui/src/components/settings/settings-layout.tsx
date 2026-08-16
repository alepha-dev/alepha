import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SettingsLayoutProps {
  /**
   * The left rail — normally a {@link SettingsNav}. Omit for a settings page
   * with a single screen and nothing to navigate between.
   */
  nav?: ReactNode;

  /**
   * Full-width block above both columns: an identity card, a page title, a
   * back link. Rendered inside the centred container, so it lines up with the
   * content rather than the viewport.
   */
  header?: ReactNode;

  /**
   * The routed content — normally a `NestedView`.
   */
  children: ReactNode;

  /**
   * Bound the shell to its parent's height and give the content column its
   * own scrollbar, instead of letting the document scroll.
   *
   * Turn it on when this layout is mounted inside a host that has already
   * taken the viewport height and hidden its own overflow — an application
   * shell built as `h-svh … overflow-hidden`, which is the usual shape for an
   * app with a fixed header. In that host the default (below) has no scrollbar
   * to give: the document cannot scroll, so anything past the fold is simply
   * unreachable.
   *
   * The mode is deliberately not auto-detected. Reading the ancestor chain for
   * a clipping parent is a layout-effect away from a flash of the wrong shape
   * on every mount, and the host already knows the answer at boot.
   *
   * It serves both kinds of page at once, which is why there is one flag
   * rather than two:
   *
   * - A natural-height page (a stack of {@link SettingsSection} cards) exceeds
   *   the column and scrolls it — the same reading experience as the default,
   *   just against a nearer scroll root.
   * - A page that opts into `flex-1 min-h-0` is bounded by the column instead,
   *   so it can hand the scroll to a child. That is what lets a table keep its
   *   filters and pagination bar pinned while only its rows move.
   */
  fill?: boolean;

  className?: string;
}

/**
 * Centred two-column shell for a settings area: sticky rail on the left,
 * content on the right, stacked on small screens.
 *
 * `min-w-0` on the content column is load-bearing. A grid/flex child defaults
 * to `min-width: auto`, which is the *content's* intrinsic width — so one
 * unbreakable string (an API key, a long email, a `<pre>` block) makes the
 * column refuse to shrink and pushes the whole page into horizontal scroll,
 * rail included. `min-w-0` lets it shrink and lets the child's own
 * `overflow` handle it.
 *
 * By default there is no scroll container here and the page scrolls, because
 * a nested `overflow-auto` would strand the sticky rail against the wrong
 * scroll root. Pass {@link SettingsLayoutProps.fill} when the host has already
 * claimed the viewport height and clipped its own overflow, so there is no
 * page scroll left to inherit.
 *
 * `md:items-start` becomes `md:items-stretch` under `fill` so the content
 * column is as tall as the row rather than as tall as its content — a column
 * sized by its content can never be the thing that scrolls. The rail is
 * unaffected either way: it carries its own `md:self-start`, which outranks
 * whatever the row aligns to.
 *
 * ⚠️ **`fill` engages at `md` and up only, and the root keeps a scrollbar at
 * every width.** Below `md` the rail is not a rail: it stacks above the
 * content as a full list of links, which on a phone is most of the viewport.
 * Splitting what little is left into a second bounded pane gives a page a few
 * hundred pixels it cannot grow out of — a table lands in a box too short to
 * show a row, and because that table owns its own scroll, nothing above it can
 * scroll to make room. So the mobile shape stays the default one: the root
 * scrolls, rail and content together. At `md` and up the row is bounded, so
 * the root's scrollbar never has anything to show and the content column is
 * the scroll root instead.
 */
export const SettingsLayout = (props: SettingsLayoutProps) => {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-5xl p-4 md:pt-10",
        props.fill && "flex h-full min-h-0 flex-col overflow-y-auto",
        props.className,
      )}
    >
      {props.header ? <div className="mb-6">{props.header}</div> : null}
      <div
        className={cn(
          "flex flex-col gap-6 md:flex-row md:items-start",
          props.fill && "md:min-h-0 md:flex-1 md:items-stretch",
        )}
      >
        {props.nav}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-8",
            props.fill && "md:min-h-0 md:overflow-y-auto",
          )}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
};
