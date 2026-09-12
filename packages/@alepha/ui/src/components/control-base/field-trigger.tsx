import * as React from "react";

void React;

import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

/**
 * How tall and how loud a field trigger is.
 *
 * `xs` exists for a control that sits ON a row of text rather than in a form:
 * the quest rail's Release field beside its Assigned picker, where a
 * default-height boxed select reads as heavier than every line around it.
 */
export type ControlTriggerSize = "xs" | "sm" | "default";

/**
 * Per-size trigger geometry. Kept as one table rather than scattered
 * conditionals so a new size is one row and the axes cannot drift.
 *
 * `chevron` targets the trigger's own last SVG - the one `ComboboxTrigger`
 * appends at a hardcoded `size-4`. That file is stock shadcn, refreshed
 * wholesale by `yarn sync`, so it is sized from here rather than edited. A
 * date trigger writes its own chevron and lands on the same rule, since it is
 * that trigger's last SVG too.
 *
 * ⚠️ `clear` and `clearGap` are in this table for the reason feedback #2113
 * exists: they used to be the constants `right-8` and `mr-6`, tuned for the
 * default size. 32px is the default's right padding (8px) plus its chevron
 * (16px) plus a gap, so at `sm` and `xs` - where both shrink - the `x` stayed
 * 32px from the edge while the chevron moved left, and it landed on the
 * value. Anything positioned against the chevron belongs beside the chevron's
 * own size. Every row leaves the same 8px between the `x` and the chevron.
 *
 * - `clear` is the button's offset from the trigger's right edge, spelled as
 *   the negative margin that walks it back from there - see
 *   {@link ControlClearButton} for why it is a margin and not a `right-*`.
 * - `clearGap` is the margin that stops the LABEL running under it. On the
 *   label rather than in the trigger's padding: the chevron is the trigger's
 *   last flex child under `justify-between`, so padding the trigger walks
 *   the chevron inwards and leaves the button hanging off its right.
 */
export const TRIGGER_SIZES: Record<
  ControlTriggerSize,
  {
    trigger: string;
    icon: string;
    chevron: string;
    clear: string;
    clearGap: string;
  }
> = {
  default: {
    trigger: "h-8 gap-1.5 py-2 pr-2 pl-2.5 text-sm",
    icon: "size-4",
    chevron: "[&>svg]:size-4",
    clear: "-ml-8",
    clearGap: "mr-6",
  },
  sm: {
    trigger: "h-7 gap-1.5 py-1 pr-1.5 pl-2 text-sm",
    icon: "size-3.5",
    chevron: "[&>svg]:size-3.5",
    clear: "-ml-7",
    clearGap: "mr-5",
  },
  xs: {
    trigger: "h-6 gap-1 px-1 text-xs",
    icon: "size-3",
    chevron: "[&>svg]:size-3",
    clear: "-ml-5",
    clearGap: "mr-4",
  },
};

/**
 * The bordered box a control opens a popup from.
 *
 * ⚠️ **One string, and the reason it is not three.** It used to live in
 * `control-select` alone, while `ControlDate` and `ControlDateRange` rendered
 * a `Button variant="outline"` and then spent five comments undoing the
 * button-ness of it: the outline border token, the hover fill, the
 * open-state fill, the placeholder colour. Every one of those was a fix for
 * the same thing - a button is not a field - and the two calendars were still
 * the odd ones out on the filter bar that reported it (feedback #2197).
 *
 * So a trigger is this, plus one row of {@link TRIGGER_SIZES}, and nothing
 * else. The caller adds only what is genuinely its own: the muted state while
 * empty, and whatever width the surface wants.
 */
export const TRIGGER_CLASSES =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex w-full items-center justify-between rounded-lg border bg-transparent whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The bordered box, or nothing at all.
 *
 * `minimal` drops the border, the background and the shadow, and pulls the
 * trigger left by its own padding so its text aligns with plain rows beside
 * it. The hover tint is what keeps it discoverable as a control.
 */
export const TRIGGER_MINIMAL_CLASSES =
  "-mx-1 border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-input/50";

/**
 * The box a control draws its trigger and its clear `x` in.
 *
 * ⚠️ **A flex row, and that is the whole of #Q2283.** It used to be
 * `relative w-full` with the `x` `absolute right-8` inside it, which positions
 * the `x` against the WRAPPER - and the wrapper is the `FormField`'s full
 * width while the trigger is only whatever `triggerClassName` made it. A
 * `w-40` trigger in an ordinary stacked form therefore had its `x` some 480px
 * to the right of it, floating in the field's empty half. It stayed invisible
 * for a long time because the surfaces that narrow a trigger are filter bars,
 * where the fields carry `label=""` and no description so the box hugs the
 * trigger and the two edges coincide.
 *
 * The wrapper cannot fix that by sizing itself to the trigger: a trigger is
 * `w-full` by default, so a shrink-to-fit wrapper and a percentage-width child
 * size from each other and collapse to the text. Nor can the width be swept
 * onto the wrapper at the call sites - `triggerClassName` also carries skins
 * (`dt-input` brings its own border and padding), and a wrapper wearing those
 * draws a second box behind the trigger.
 *
 * So the `x` stops being positioned against a box at all: it is the trigger's
 * next flex sibling and walks back from wherever the trigger's own right edge
 * lands. No call site changes, and no width can ever be wrong again.
 */
export const TRIGGER_WRAPPER_CLASSES = "flex w-full items-center";

export interface ControlClearButtonProps {
  /**
   * Which row of {@link TRIGGER_SIZES} positions it. Defaults to `default`.
   */
  size?: ControlTriggerSize;
  /**
   * Put the field back to empty.
   */
  onClick: () => void;
}

/**
 * The `x` that puts a `clearable` field back to empty in one click.
 *
 * ⚠️ Rendered BESIDE the trigger and drawn ON it, never inside it: a button
 * nested in a button is invalid, and Base UI's triggers - combobox and popover
 * alike - would swallow its click anyway. The wrapper is the caller's
 * {@link TRIGGER_WRAPPER_CLASSES} div, and the two are adjacent siblings,
 * which is what `[data-slot="date-trigger"] + [data-slot="control-clear"]`
 * selects on.
 *
 * ## Two steps left, and neither of them is a `right-*`
 *
 * The button is IN FLOW, as the trigger's next flex sibling, and walks back
 * over it from there:
 *
 * - `clear` from {@link TRIGGER_SIZES} (`-ml-8` at the default size) is the
 *   offset from the trigger's right edge, the one number feedback #2113
 *   tuned per size.
 * - `-translate-x-full` is the button's own width, which the margin cannot
 *   know: a flex item's margin places its LEFT edge, and the offset above
 *   describes its right one.
 *
 * That is one number more than `absolute right-8` needed, and it buys the
 * thing `absolute` could not have: the reference is the TRIGGER, not the box
 * around it (#Q2283).
 *
 * ⚠️ It also retires `MINIMAL_CLEAR_SHIFT`, and that correction was pointing
 * the WRONG WAY. It read the `-mx-1` in {@link TRIGGER_MINIMAL_CLASSES} as
 * putting the trigger's right edge 4px past the wrapper, so it moved the `x`
 * 4px right to follow. A block with `width: 100%` and a negative right margin
 * is over-constrained, so the browser drops that margin: the edge is 4px
 * SHORT of the wrapper, and the correction doubled the error. Measured in the
 * showcase, a minimal trigger's `x` ended 12px from its right edge with the
 * chevron starting at 16px - a 5px overlap of the two glyphs. In flow there
 * is nothing to correct: the margin moves where the next sibling starts, the
 * `x` follows, and every size and variant now leaves the same 8px gap.
 *
 * `relative` for the paint order alone: the button overlaps the trigger, and
 * a positioned element paints above a static one whatever the DOM order.
 *
 * ⚠️ This is the affordance the injected clear ROW used to be, moved to
 * where it belongs (feedback #2098). Deleting the row made the empty state
 * a placeholder rather than a third pickable value, which is what the
 * report asked for.
 *
 * ## Why the `x` and not the row, stated properly
 *
 * An earlier version of this comment said the `x` had to exist because
 * `epics.spec.ts` went red when the row was deleted. **That was circular
 * and is corrected here.** The spec went red because its SELECTOR named a
 * node that no longer existed; the fix could equally have been one line
 * re-clicking the selected release. A broken locator is not a usability
 * finding.
 *
 * The real reasons, none of which that argument gave:
 *
 * - **Re-click-to-deselect is counter-conventional, not merely quiet.** In
 *   a native `select`, and in almost every combobox people use daily,
 *   clicking the chosen option confirms and closes. No learned model says
 *   it removes the value, so it is neither discovered by accident nor
 *   retained after being shown once.
 * - **"Reset filters" is not a fallback.** It is all or nothing. With
 *   status, area and release all set, dropping just the release is a
 *   different intent, and `AlephaTable`'s menu has no per-filter escape.
 * - **It costs nothing at rest**, since a caller only draws it with a value.
 *
 * ## No row comes back, at any size
 *
 * Feedback #2113 proposed a `None` row for `minimal`/`xs`, and the owner
 * dropped it the same day: this control had already been changed twice in
 * opposite directions, and keeping the row out leaves that sweep intact.
 * The `x` is the one answer everywhere it is drawn.
 *
 * ## One accessible name, for every control that draws it
 *
 * `controlSelect.clear` names the key rather than the caller, and it stays
 * that way now that a calendar uses it too: the string is already translated
 * everywhere the kit ships, and renaming a key to match its widest consumer
 * buys nothing a reader ever sees. It replaces the two hardcoded English
 * labels the date controls carried, which is how a French app came to have a
 * "Clear date range" button in the middle of a translated filter bar.
 */
export const ControlClearButton = (props: ControlClearButtonProps) => {
  const { tr } = useI18n();
  const size = TRIGGER_SIZES[props.size ?? "default"];

  return (
    <button
      type="button"
      data-slot="control-clear"
      aria-label={String(
        tr("controlSelect.clear", { default: "Clear selection" }),
      )}
      className={cn(
        // ⚠️ Lighter than the chevron at rest, and it sharpens when
        // reached for. They are not peers: the chevron is decoration,
        // since the whole trigger opens the popup and nobody aims at
        // it, while this is the only element here with its own hit
        // target and its own action. Two equal grey glyphs side by
        // side make the eye separate them every time, and on a filter
        // rail with three filters set that is paid three times.
        //
        // Alpha on the TEXT COLOR, deliberately, and three things this
        // is not:
        //
        // - not a hover reveal. It must stay visible at rest: it is
        //   the only discoverable way to clear, there is no hover on
        //   touch, and an element appearing under the arriving pointer
        //   makes the control feel twitchy.
        // - not `opacity` on the button, which would fade the focus
        //   ring with it and weaken the keyboard state exactly when it
        //   needs to be strongest.
        // - not a background. `styles.css` defines a single muted
        //   tier, and alpha fades toward the trigger's own surface, so
        //   it lightens in light mode and darkens in dark with no
        //   per-theme override.
        "text-muted-foreground/60 hover:text-foreground focus-visible:text-foreground focus-visible:ring-ring/50 relative shrink-0 -translate-x-full rounded p-0.5 transition-colors outline-none focus-visible:ring-2",
        size.clear,
      )}
      onClick={props.onClick}
    >
      <X className="size-3.5" />
    </button>
  );
};
