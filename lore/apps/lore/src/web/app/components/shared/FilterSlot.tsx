import type { ReactNode } from "react";

export interface FilterSlotProps {
  children: ReactNode;
}

/**
 * One filter's slot in a filter bar, and the only place its width is decided.
 *
 * Every quest filter in the app is a `Control` with `label=""` inside a
 * fixed-width box. The width used to be written at each call site, which is
 * how the Quests table ended up at `w-44` and the Kanban bar at `w-64`
 * filtering the same two fields (quest #1639). One component, one width, so
 * the two bars cannot drift again.
 *
 * `max-w-full` so a narrow board column shrinks the control instead of
 * pushing the bar sideways.
 */
const FilterSlot = (props: FilterSlotProps) => {
  return <div className="w-44 max-w-full">{props.children}</div>;
};

export default FilterSlot;
