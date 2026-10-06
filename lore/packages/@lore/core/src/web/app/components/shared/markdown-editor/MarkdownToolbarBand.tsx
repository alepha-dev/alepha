import type { ReactNode } from "react";

export interface MarkdownToolbarBandProps {
  /**
   * Pull the bar out to the frame's edges. The framed editor pads itself
   * (`p-3`), and a bar sitting inside that padding reads as a widget in the
   * field rather than the field's own header; the bare variant has no
   * padding to escape.
   */
  flush?: boolean;
  /**
   * The formatting buttons, in edit mode. Empty in view mode - see below.
   */
  children?: ReactNode;
}

/**
 * The strip across the top of the editor: its height, its rule and the
 * corner it reserves for the mode toggle.
 *
 * ## Why the band is its own component
 *
 * It renders in BOTH modes, and empty in view mode (feedback #P2147).
 * Before this, view mode rendered no band at all, so its height left the
 * layout and everything below slid up: on a form, the buttons a reader was
 * about to press moved the moment they pressed Preview.
 *
 * The formatting buttons themselves do NOT survive the switch - they act on
 * a CodeMirror selection and there is none over rendered output - so what
 * has to be identical in the two modes is the band, not its contents. One
 * component owning the height is what makes that true by construction
 * rather than by two class strings agreeing.
 *
 * ⚠️ `min-h-8`, not `h-8`. Empty it is exactly 32px, which is `icon-xs`
 * (24px) plus the row's padding - the filled height at any normal width.
 * The bar wraps at a narrow enough field, and a fixed height would clip the
 * second row rather than let it grow; the jump can still return there,
 * which is strictly better than the jump being unconditional.
 *
 * ⚠️ `pr-10` is the mode toggle's corner. It floats over the frame
 * (`LoreEditor`), not inside this, so the padding is what keeps the buttons
 * from running underneath it - and it is why the band matters in view mode
 * even with nothing in it: the toggle has the same corner in both.
 */
const MarkdownToolbarBand = (props: MarkdownToolbarBandProps) => {
  return (
    <div
      data-testid="markdown-toolbar-band"
      className={`border-border mb-2 flex min-h-8 flex-wrap items-center gap-0.5 border-b px-2 pr-10 ${props.flush ? "-mx-3 -mt-3" : ""}`}
    >
      {props.children}
    </div>
  );
};

export default MarkdownToolbarBand;
