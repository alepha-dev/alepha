import { useI18n } from "alepha/react/i18n";
import { FunnelX, X } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import { cn } from "../core/utils.ts";

export interface AlephaTableFilterControlProps {
  /**
   * What this filter is called. Not drawn here - a set select names itself on
   * its trigger through `triggerPrefix` ("Status not Active"), and an empty
   * one through its placeholder - but it names the button ("Remove filter:
   * Status"), which is the only accessible name that button will ever have.
   *
   * ⚠️ It was also a hover tooltip on the control, and that was removed on
   * 2026-09-13: once the trigger carries the name, the tooltip repeated what
   * was already on screen.
   */
  label: string;

  /**
   * The filter itself, unchanged: a `Control` with `label=""`, exactly as it
   * is written today. This component adds chrome AROUND a control and never
   * alters one.
   */
  children: ReactNode;

  /**
   * Take this filter out of the bar.
   *
   * ⚠️ NOT "clear its value" - that is `onClear`, and the cross runs them in
   * that order (see the docblock below). A filter with neither draws no cross
   * at all, which is how the bar keeps a filter that may not leave.
   *
   * The caller is expected to clear the filter's value as it removes it.
   * Removing a filter that is still narrowing the list leaves the reader with
   * a shorter list and nothing on screen explaining why.
   */
  onRemove?: () => void;

  /**
   * Empty this filter without taking it out of the bar.
   *
   * Given alongside `onRemove`, it becomes the cross's FIRST act: a filter
   * holding a value is cleared, and only a filter already empty is removed.
   * Given alone - the search box, which may not leave - the cross appears
   * only while there is something to clear and does nothing else.
   */
  onClear?: () => void;

  /**
   * Whether this filter currently holds a value. Draws nothing: the value on
   * the trigger already says it, and a darker border on top of that was
   * tried and dropped on 2026-09-13.
   *
   * ⚠️ It decides which act the cross performs, so a caller that passes
   * `onClear` and forgets this gets a cross that removes a filter the reader
   * expected it to empty.
   */
  active?: boolean;
}

/**
 * One filter's slot in an `AlephaTable` filter bar: the control, and the
 * cross that removes it.
 *
 * **One box, not a control with a button beside it.** The container draws the
 * border and the control inside is stripped of its own, so the remove action
 * reads as part of the field rather than as a separate thing that happens to
 * be adjacent - which is what a detached button looked like, and why it was
 * never obvious which filter a cross belonged to in a row of four.
 *
 * ```text
 * ( icon  Any status  ▾ │ × )
 * ```
 *
 * ⚠️ Three other designs were built and thrown away on 2026-09-12, and the
 * reasons are worth keeping so they are not re-proposed: a detached trailing
 * button (ambiguous ownership, and it truncated the control it sat beside); a
 * strip of actions sliding out from behind the control on hover (nothing
 * discoverable, and it overlapped whatever the page put above the bar); and
 * an always-present label row carrying the actions (cost a row of labels that
 * `label=""` exists to remove). This is what survived.
 *
 * ⚠️ The control's own `clearable` cross is HIDDEN here whenever this draws a
 * button. Two crosses a few pixels apart - one clearing the VALUE, one
 * removing the FILTER - is the ambiguity this design exists to remove, and at
 * this size they are the same glyph. It hides the affordance, not the
 * capability: the one button does both jobs in turn.
 *
 * Given neither `onClear` nor `onRemove`, it draws no button and hides
 * nothing, so the control keeps the cross inside its own field. That is the
 * search box: a filter that never leaves the bar has only one job for a cross,
 * and the field's own is the one every search box has.
 *
 * **The button is staged: clear, then remove.** A filter holding a value is
 * emptied by the first click and removed by the second, and the two acts do
 * not share a glyph: a cross empties the field, a struck-through funnel takes
 * the filter out of the bar. The destructive half is therefore never the one
 * a reader reaches first, and never wears the icon of the other - which
 * matters because emptying a filter is what they usually mean, and a filter
 * they configured and then lost to a stray click has to be added and
 * configured again.
 *
 * The stage is legible before the click from the icon, the tooltip ("Clear
 * value" against "Remove filter") and the accessible name, and afterwards
 * from the icon changing.
 *
 * ⚠️ The tooltip needs a `TooltipProvider` above it, like every other tooltip
 * in this package; `apps/ui` and `apps/lore` both mount one in their layout.
 *
 * The value has to clear through `onClear` rather than through the control,
 * because the container is given `active` and cannot reach into the field it
 * wraps - the caller owns the form.
 */
export const AlephaTableFilterControl = (
  props: AlephaTableFilterControlProps,
) => {
  const { tr } = useI18n();
  // The first act while the filter holds a value, the second once it is
  // empty. `onClear` alone never escalates: the search box may not leave.
  const clears = Boolean(props.onClear && props.active);
  const action = clears ? props.onClear : props.onRemove;
  const ActionIcon = clears ? X : FunnelX;
  // ⚠️ Two labels, and they are not the same string. The TOOLTIP names the
  // act and nothing else - it is read beside the filter it belongs to, so
  // repeating that filter's name in it is noise on every hover. The
  // ACCESSIBLE name has to carry the filter, because a screen reader meets
  // these buttons as a list and "Remove filter" four times over says which
  // one it is about exactly never.
  const label = String(
    clears
      ? tr("alephaTable.clearValue", { default: "Clear value" })
      : tr("alephaTable.removeFilter", { default: "Remove filter" }),
  );
  const actionLabel = `${label}: ${props.label}`;

  return (
    <div
      className={cn(
        "bg-background border-input flex items-stretch overflow-hidden rounded-md border",
        // The field's own two states, moved out to the container: it is the
        // thing with a border now, so it has to answer for them.
        "hover:border-[var(--input-hover)]",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-[3px]",
        // The control keeps its layout and loses only its frame. Both slots
        // are covered because a text filter draws `input` and a select draws
        // `combobox-trigger`, and a bar mixes the two.
        //
        // ⚠️ The ring has to go as well as the border. Leaving it turns focus
        // into a rounded rectangle floating INSIDE the container, which looks
        // like a rendering bug rather than a focused field.
        "[&_[data-slot=input]]:rounded-none [&_[data-slot=input]]:border-0 [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:shadow-none [&_[data-slot=input]]:focus-visible:ring-0",
        "[&_[data-slot=combobox-trigger]]:rounded-none [&_[data-slot=combobox-trigger]]:border-0 [&_[data-slot=combobox-trigger]]:bg-transparent [&_[data-slot=combobox-trigger]]:shadow-none [&_[data-slot=combobox-trigger]]:focus-visible:ring-0",
        // See the docblock: the control's own clear cross would be a second,
        // identical glyph beside the remove one. Only then, though: a filter
        // given neither `onClear` nor `onRemove` draws no button of its own,
        // so its control keeps its classic in-field cross - the search box.
        (props.onClear || props.onRemove) &&
          '[&_[data-slot="combobox-clear"]]:hidden [&_[data-slot="control-clear"]]:hidden',
      )}
    >
      {/*
        `min-w-0` so the control absorbs the button's width by shrinking
        instead of pushing it out of the slot - a flex child's default
        `min-width: auto` refuses to go below its content.
      */}
      <div className="min-w-0 flex-1">{props.children}</div>
      {action && (
        <>
          {/*
            The divider, and it is doing real work: without it the cross
            floats in the same field as the value and reads as part of it - a
            second caret rather than a separate act. `bg-input` is the
            container's own resting border colour, so the line is that border
            continued inward.
          */}
          <span aria-hidden className="bg-input w-px self-stretch" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex shrink-0 items-center justify-center px-2 focus-visible:outline-none"
                  aria-label={actionLabel}
                  onClick={action}
                />
              }
            >
              {/*
                The funnel is the denser glyph of the two and reads smaller at
                the same box, so it is drawn a step larger to sit at the same
                visual weight as the cross it replaces.
              */}
              <ActionIcon className={clears ? "size-3" : "size-3.5"} />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
};
