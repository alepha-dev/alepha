import { useInject } from "alepha/react";

import {
  type PinnedPrompts,
  PinnedPromptsSlot,
} from "../../../../registries/PinnedPromptsSlot.ts";

export interface UsePinnedPromptsOptions {
  /**
   * Off: nothing is read.
   */
  enabled?: boolean;
}

/**
 * The pins a page's table offers on its rows (#Q4284), as core's slot
 * (#E175): what `@lore/prompts` registered on {@link PinnedPromptsSlot}, or
 * no row and no dialog while the slot is unfilled. The slot's hook is the
 * same for the container's whole life, so the hooks it calls keep their
 * order.
 */
export const usePinnedPrompts = (
  options: UsePinnedPromptsOptions = {},
): PinnedPrompts => {
  const usePins = useInject(PinnedPromptsSlot).usePins ?? useNoPins;
  return usePins(options);
};

/**
 * The unfilled slot's answer: nothing pinned.
 */
const useNoPins = (_options?: UsePinnedPromptsOptions): PinnedPrompts => ({
  rowGroup: () => [],
  dialog: null,
});
