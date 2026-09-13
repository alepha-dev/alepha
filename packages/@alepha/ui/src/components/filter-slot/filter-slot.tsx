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
 * The width is a MINIMUM, not a fixed size: `min-w-[13.2rem]` with no
 * `max-w`. A filter that holds a long value ("Admin, Owner") grows to show
 * it rather than truncating inside a box the bar has plenty of room to
 * widen, and a bar of four short filters still lines up because they all
 * start from the same floor.
 *
 * ⚠️ It was `w-44` and then `w-[13.2rem] max-w-full` - both fixed. The fixed
 * width is what made every selected value truncate at the same point
 * regardless of how much space the bar actually had.
 *
 * ⚠️ **A floor cannot shrink, so the ROW has to wrap.** A fixed width could
 * be squeezed by a flex row; a minimum cannot. Put slots in a `flex-wrap` row
 * (`AlephaTable`'s own form already is one), or three of them hold 650px in a
 * 375px phone. That was measured on Lore's kanban bar and the admin bars when
 * the floor landed, and each of those rows gained `flex-wrap` with it (#Q2308).
 * `max-w-full` still caps a single long value at the width of its row.
 */
export const FilterSlot = (props: FilterSlotProps) => {
  return <div className="max-w-full min-w-[13.2rem]">{props.children}</div>;
};
