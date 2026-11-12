import * as React from "react";

void React;

import { Link } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export interface SidebarBackHeaderProps {
  /**
   * Where the arrow leads: the application's home, out of a root shell such
   * as `/admin` that is not drawn inside the application's own
   * chrome. Absent, there is no arrow, for an application with nowhere to
   * go back to.
   */
  href?: string;
  /**
   * Names the arrow for assistive technology, since it shows only an icon.
   */
  label: string;
  /**
   * What the header says beside the arrow: an icon and a title, or a whole
   * identity block. Hidden when the sidebar folds to its icon rail, where
   * the arrow alone stays.
   */
  children: ReactNode;
}

/**
 * A root shell's sidebar header with a way out: a back arrow to the
 * application's home, then what the area is.
 *
 * A root shell such as `/admin` owns the viewport, so the application's
 * sidebar and its links are gone while it is open, and the only other way
 * back is an item inside the account menu. The arrow is a real `Link`, so home can also
 * be opened in a new tab.
 *
 * Collapsed to the icon rail, the words go and the arrow stays: it is the
 * one part of the header a reader still needs there.
 */
export const SidebarBackHeader = (props: SidebarBackHeaderProps) => {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
      {props.href && (
        <Link
          href={props.href}
          aria-label={props.label}
          className="text-muted-foreground hover:bg-hover hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
        </Link>
      )}
      <div className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
        {props.children}
      </div>
    </div>
  );
};
