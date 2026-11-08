import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "./utils.ts";

export type CollapsibleProps = CollapsiblePrimitive.Root.Props;

/**
 * A disclosure: a trigger that opens and closes a panel, its height
 * animated. Uncontrolled with `defaultOpen`, controlled with `open` and
 * `onOpenChange`.
 *
 * ```tsx
 * <Collapsible>
 *   <CollapsibleTrigger chevron>Advanced options</CollapsibleTrigger>
 *   <CollapsiblePanel>...</CollapsiblePanel>
 * </Collapsible>
 * ```
 *
 * The root and the panel carry `data-open` or `data-closed`, and the trigger
 * `data-panel-open` while the panel is open, for the caller's own styles.
 */
const Collapsible = (props: CollapsibleProps) => {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
};

export interface CollapsibleTriggerProps
  extends CollapsiblePrimitive.Trigger.Props {
  /**
   * Draw a chevron after the children, pointing down while closed and up
   * while open. Defaults to `false`.
   */
  chevron?: boolean;
}

/**
 * The button that opens and closes the panel. It carries `aria-expanded` and
 * `aria-controls`. Its own styles are minimal (a row of its children, a focus
 * ring): pass `render={<Button variant="ghost" />}` for a button look.
 */
const CollapsibleTrigger = (props: CollapsibleTriggerProps) => {
  const { className, chevron = false, children, ...rest } = props;
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "group/collapsible-trigger focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md text-sm font-medium outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
      {chevron && (
        <ChevronDownIcon
          aria-hidden
          data-slot="collapsible-chevron"
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-[panel-open]/collapsible-trigger:rotate-180 motion-reduce:transition-none"
        />
      )}
    </CollapsiblePrimitive.Trigger>
  );
};

export type CollapsiblePanelProps = CollapsiblePrimitive.Panel.Props;

/**
 * The panel the trigger opens. Its height runs from 0 to its content's
 * through `--collapsible-panel-height`, which Base UI measures, and the
 * transition is dropped under `prefers-reduced-motion`.
 *
 * Closed, it is not rendered, so nothing in it can take focus; on the server
 * it renders open or not at all, per `defaultOpen`, and opens at its natural
 * height, with no animation on the first paint. `keepMounted` keeps it in the
 * DOM while closed (hidden), and `hiddenUntilFound` lets the browser's page
 * search find and open it.
 *
 * It clips its content while it moves (`overflow-hidden`): give the content
 * its own padding rather than the panel, so the height runs to the padding's
 * edge too.
 */
const CollapsiblePanel = (props: CollapsiblePanelProps) => {
  const { className, ...rest } = props;
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none",
        className,
      )}
      {...rest}
    />
  );
};

export { Collapsible, CollapsiblePanel, CollapsibleTrigger };
