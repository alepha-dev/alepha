import type { RowActionEntry } from "@alepha/ui/table";
import { AlephaError } from "alepha";
import type { ComponentType, ReactNode } from "react";

import type { PinnedPromptItem } from "../components/project/prompts/pins/pinnedPromptItemSchema.ts";
import type { PinnedPromptsButtonProps } from "../components/project/prompts/pins/PinnedPromptsButton.tsx";

/**
 * The pins of a pinnable page (#Q4284), as a slot of core's (#E175): Plan's
 * and Ship's pages render `PinnedPromptsButton` and call `usePinnedPrompts`,
 * both core's, and what they draw is what the filler registered here, the
 * real button and hook of `@lore/prompts`. Unfilled, the button renders
 * nothing and the hook offers no row.
 *
 * Filled once, at boot.
 */
export class PinnedPromptsSlot {
  protected filler?: PinnedPromptsFiller;

  public fill(filler: PinnedPromptsFiller): void {
    if (this.filler) {
      throw new AlephaError("The pinned prompts slot is already filled");
    }
    this.filler = filler;
  }

  /**
   * The robot button a page draws, or undefined while unfilled.
   */
  public get Button(): ComponentType<PinnedPromptsButtonProps> | undefined {
    return this.filler?.Button;
  }

  /**
   * The hook behind `usePinnedPrompts`, or undefined while unfilled. The
   * same function for the container's whole life, so calling the one this
   * answers keeps the order of a component's hooks.
   */
  public get usePins():
    | ((options?: { enabled?: boolean }) => PinnedPrompts)
    | undefined {
    return this.filler?.usePins;
  }
}

export interface PinnedPromptsFiller {
  Button: ComponentType<PinnedPromptsButtonProps>;
  usePins: (options?: { enabled?: boolean }) => PinnedPrompts;
}

/**
 * What a page's table reads of the pins: a row's Agent prompts group, and
 * the dialog its entries open, which the page renders.
 */
export interface PinnedPrompts {
  rowGroup: <T>(
    viewPage: string,
    item: PinnedPromptItem,
  ) => RowActionEntry<T>[];
  dialog: ReactNode;
}
