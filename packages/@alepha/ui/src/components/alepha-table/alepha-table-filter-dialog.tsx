import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@alepha/ui/components/ui/dialog";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Funnel } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

export interface AlephaTableFilterDialogProps {
  /**
   * The table's own filter form. The SAME instance the toolbar bar would
   * render — this component never builds one of its own, or a filter set in
   * here would live in a model `fetch` does not read.
   */
  form: FormModel<any>;
  /**
   * The caller's `filters.render(form)` output, already invoked. Passing the
   * rendered nodes rather than the callback keeps this component unaware of
   * the `AlephaTableFilters` shape.
   */
  children: ReactNode;
  /**
   * How many filters currently narrow the list. Renders as a badge on the
   * trigger, and gates the Reset button.
   */
  activeCount: number;
  onReset: () => void;
}

/**
 * The filter bar, on a phone.
 *
 * Below `useIsMobile`'s breakpoint the bar's controls cost several rows of
 * height above a table the reader came for — three selects and a search box
 * stack at 412px — so they move behind this trigger and the bar itself is not
 * rendered (feedback #2106).
 *
 * Three decisions worth stating, because each had a plausible opposite:
 *
 * - **Not rendered, not `hidden`.** The controls are form-bound `Control`s, so
 *   a CSS-hidden bar plus a dialog copy would put two inputs on every field —
 *   duplicate ids, two labels pointing at one name. `AlephaTable` renders the
 *   filters in exactly one place at a time, which is why the switch is
 *   `useIsMobile()` and not a `max-md:hidden` class.
 * - **Applies on change, not on close.** The desktop bar refetches as you type
 *   (debounced, on the alepha event bus rather than on any DOM event — which
 *   is what lets these controls work identically inside a portal). Apply /
 *   Cancel semantics here would be a second behaviour for the same controls,
 *   and would mean the reader's filters behave differently depending on the
 *   width of their screen. Done just closes.
 * - **The trigger carries a count.** A button that looks the same whether or
 *   not three filters are narrowing the list turns a filtered table into one
 *   that looks broken, and on a phone the bar is no longer there to say
 *   otherwise.
 */
export const AlephaTableFilterDialog = (
  props: AlephaTableFilterDialogProps,
) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const label = tr("alephaTable.filters", { default: "Filters" });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 gap-1.5 px-2"
            aria-label={label}
          />
        }
      >
        <Funnel className="size-4" />
        {props.activeCount > 0 && (
          <Badge
            variant="secondary"
            className="h-5 min-w-5 justify-center px-1 text-[10px] tabular-nums"
          >
            {props.activeCount}
          </Badge>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {tr("alephaTable.filtersHint", {
              default: "Changes apply as you make them.",
            })}
          </DialogDescription>
        </DialogHeader>
        {/*
          A filter bar sizes its slots for a ROW (Lore's `FilterSlot` is
          `w-44`), and those widths are wrong stacked in a dialog: three
          176px controls left-aligned in a 348px box read as a broken layout
          rather than a form. A descendant selector outranks the plain class
          on the element, so stretching them here costs no caller a change
          and leaves the desktop bar untouched.

          Two levels, because both shapes occur: slots directly under the
          form, and slots inside one wrapper the caller uses for its own
          `flex flex-wrap`. Deeper than that keeps its own width - a limit,
          not an oversight, since the alternative is a selector broad enough
          to resize things that are not controls.
        */}
        <form
          {...props.form.props}
          className="grid grid-cols-1 gap-3 [&>*]:w-full [&>*>*]:w-full"
        >
          {props.children}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.activeCount === 0}
            onClick={props.onReset}
          >
            {tr("alephaTable.resetFilters", { default: "Reset filters" })}
          </Button>
          <DialogClose render={<Button type="button" />}>
            {tr("alephaTable.filtersDone", { default: "Done" })}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
