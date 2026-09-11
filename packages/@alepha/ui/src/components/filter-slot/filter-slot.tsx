import type { ReactNode } from "react";

export interface FilterSlotProps {
  children: ReactNode;
}

/**
 * One filter's slot in a filter bar, and the only place its width is decided.
 *
 * Every filter in a bar is a `Control` with `label=""` inside a fixed-width
 * box. The width used to be written at each call site, which is how Lore's
 * Quests table ended up at `w-44` and its Kanban bar at `w-64` filtering the
 * same two fields (quest #1639), and how the admin pages drifted to `w-52`,
 * `w-64` and `w-72` for the same search box (#Q2231). One component, one
 * width, so no two bars can drift again.
 *
 * It moved from Lore into the kit with #Q2231, so the admin console's bars
 * and Lore's project pages share it rather than each keeping a copy.
 *
 * `max-w-full` so a narrow board column shrinks the control instead of
 * pushing the bar sideways.
 */
export const FilterSlot = (props: FilterSlotProps) => {
  return <div className="w-44 max-w-full">{props.children}</div>;
};
