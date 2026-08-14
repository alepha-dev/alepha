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
 * There is no scroll container here on purpose: the page scrolls. A nested
 * `overflow-auto` would clip the flush left/right card borders that
 * {@link SettingsSection} depends on, and would strand the sticky rail
 * against the wrong scroll root.
 */
export const SettingsLayout = (props: SettingsLayoutProps) => {
  return (
    <div
      className={cn("mx-auto w-full max-w-5xl p-4 md:pt-10", props.className)}
    >
      {props.header ? <div className="mb-6">{props.header}</div> : null}
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {props.nav}
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {props.children}
        </div>
      </div>
    </div>
  );
};
