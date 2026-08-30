import { cn } from "@alepha/ui/lib/utils";
import { Loader2 } from "lucide-react";

export interface ToolbarSpinnerProps {
  loading: boolean;
  /**
   * Tailwind size class for the glyph, matched to the row it sits in.
   * Defaults to `size-4`; dense bars pass `size-3.5`.
   */
  className?: string;
}

/**
 * The busy indicator for a toolbar, and the two rules that go with it.
 *
 * **It goes at the end of the row.** A spinner ahead of the controls puts the
 * thing that appears and disappears upstream of the things people are aiming
 * at, so every fetch moves the buttons under the cursor.
 *
 * **It never changes the row's layout.** The element is always rendered and
 * only its opacity changes, so the slot it occupies is the same width whether
 * a fetch is running or not. Conditional rendering with a `gap` around it
 * moved the neighbouring controls by roughly 24px, twice per fetch: once when
 * the request started, once when it landed. A second click aimed at a
 * segmented control could land on its neighbour.
 *
 * The animation only runs while loading, and the element stays out of the
 * accessibility tree either way: it is a repaint of state that the content
 * below already carries.
 */
const ToolbarSpinner = (props: ToolbarSpinnerProps) => {
  return (
    <Loader2
      aria-hidden
      data-testid="toolbar-spinner"
      data-loading={props.loading || undefined}
      className={cn(
        "text-muted-foreground size-4 transition-opacity",
        props.loading ? "animate-spin opacity-100" : "opacity-0",
        props.className,
      )}
    />
  );
};

export default ToolbarSpinner;
