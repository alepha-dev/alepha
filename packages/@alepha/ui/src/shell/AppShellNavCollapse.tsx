import * as React from "react";

void React;

import type { ReactNode } from "react";

import { cn } from "../core/utils.ts";

export interface AppShellNavCollapseProps {
  open: boolean;
  animate: boolean;
  children: ReactNode;
}

/**
 * The open/close animation for a nav group.
 *
 * `grid-template-rows: 0fr -> 1fr` on a wrapper whose child is
 * `overflow: hidden`. That is the one way to transition to an INTRINSIC
 * height in CSS alone: `height: auto` is not interpolable, so the usual
 * alternatives are a hardcoded max-height (which either clips a long group or
 * makes a short one crawl through empty space) or measuring the subtree in an
 * effect (a layout read on every toggle, and a frame of the wrong height).
 *
 * ⚠️ The children stay MOUNTED while closed, which is what makes the height
 * animatable, so something has to do what unmounting used to: clipped content
 * is invisible but still focusable and still read aloud. `inert` does it, and
 * it is the right tool rather than `visibility: hidden` because it needs no
 * animation of its own - the clipping already hides the group, so the only
 * job left is taking it out of the tab order and the a11y tree, which is a
 * state rather than a transition.
 *
 * `min-h-0` on the inner element is load-bearing, not tidiness: a grid item's
 * automatic minimum size is its content, so without it the row never shrinks
 * below the subtree's natural height and nothing appears to animate.
 */
export const AppShellNavCollapse = (props: AppShellNavCollapseProps) => (
  <div
    data-state={props.open ? "open" : "closed"}
    inert={!props.open}
    className={cn(
      "grid grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
      props.animate &&
        "transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
    )}
  >
    <div className="min-h-0 overflow-hidden">{props.children}</div>
  </div>
);
