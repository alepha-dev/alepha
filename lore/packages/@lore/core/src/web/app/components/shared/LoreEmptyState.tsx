import { cn } from "@alepha/ui";
import type { ReactNode } from "react";

import LoreLogoAnimated from "./LoreLogoAnimated.tsx";
import type { LoreSpriteMood } from "./LoreSpriteMoods.ts";

export interface LoreEmptyStateProps {
  /**
   * What the emptiness means, which decides the state the companion is in:
   * `calm` for nothing left to do, `asleep` for nothing yet, `seeking` for
   * nothing selected, `glitch` for something that broke.
   */
  mood: LoreSpriteMood;
  /**
   * One short line naming the state.
   */
  title: ReactNode;
  /**
   * A sentence under the title: what will appear here, or what to do.
   */
  description?: ReactNode;
  /**
   * Actions under the text, a button or two. Most empty states need none.
   */
  children?: ReactNode;
  /**
   * Added to the root, which fills its parent's height by default: a full
   * page passes its own height here.
   */
  className?: string;
}

/**
 * An empty or broken screen, said by the Lore companion: she is drawn in the
 * mood the state calls for, over a patch of the page's dot grid that fades
 * out around her, with a title, a sentence and optional actions under her.
 *
 * She is decoration here, hidden from assistive technology: the title and
 * the sentence carry the whole message, and they are all that renders where
 * there is no canvas.
 */
const LoreEmptyState = (props: LoreEmptyStateProps) => {
  return (
    <div
      data-slot="lore-empty-state"
      data-mood={props.mood}
      className={cn(
        "relative flex h-full flex-col items-center justify-center overflow-hidden p-8 text-center",
        props.className,
      )}
    >
      <div aria-hidden className="relative -mb-2">
        <div className="lore-empty-dots pointer-events-none absolute top-1/2 left-1/2 h-[30rem] w-[40rem] -translate-x-1/2 -translate-y-1/2" />
        <LoreLogoAnimated mood={props.mood} className="relative size-48" />
      </div>
      <p className="relative text-base font-medium">{props.title}</p>
      {props.description && (
        <p className="text-muted-foreground relative mt-1.5 max-w-xs text-sm text-balance">
          {props.description}
        </p>
      )}
      {props.children && (
        <div className="relative mt-4 flex flex-wrap items-center justify-center gap-2">
          {props.children}
        </div>
      )}
    </div>
  );
};

export default LoreEmptyState;
