import { useInject, useStore } from "alepha/react";

import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import {
  type PinnedPrompts,
  PinnedPromptsSlot,
} from "../../../../registries/PinnedPromptsSlot.ts";
import { hasCapability } from "../../../../services/projectCapabilities.ts";

export interface UsePinnedPromptsOptions {
  /**
   * Off: nothing is read.
   */
  enabled?: boolean;
}

/**
 * The pins a page's table offers on its rows (#Q4284), as core's slot
 * (#E175): what `@lore/prompts` registered on {@link PinnedPromptsSlot}, or
 * no row and no dialog while the slot is unfilled or the project has the
 * `prompts` capability off. The slot's hook is the same for the
 * container's whole life, so the hooks it calls keep their order: off, it
 * is still called, reading nothing.
 */
export const usePinnedPrompts = (
  options: UsePinnedPromptsOptions = {},
): PinnedPrompts => {
  const usePins = useInject(PinnedPromptsSlot).usePins ?? useNoPins;
  const [project] = useStore(currentProjectAtom);
  const on = hasCapability(project, "prompts");
  const pins = usePins({
    ...options,
    enabled: on && (options.enabled ?? true),
  });
  return on ? pins : NO_PINS;
};

/**
 * The unfilled slot's answer: nothing pinned.
 */
const NO_PINS: PinnedPrompts = { rowGroup: () => [], dialog: null };

/**
 * The unfilled slot's hook.
 */
const useNoPins = (_options?: UsePinnedPromptsOptions): PinnedPrompts =>
  NO_PINS;
