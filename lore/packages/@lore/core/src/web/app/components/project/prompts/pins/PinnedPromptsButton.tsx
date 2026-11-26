import { useInject, useStore } from "alepha/react";

import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import { PinnedPromptsSlot } from "../../../../registries/PinnedPromptsSlot.ts";
import { hasCapability } from "../../../../services/projectCapabilities.ts";
import type { PinnedPromptItem } from "./pinnedPromptItemSchema.ts";

export interface PinnedPromptsButtonProps {
  /**
   * The pinnable page's key (`quest`, `epics`, ...).
   */
  page: string;
  /**
   * The item the page gives, which fills the prompt's arg of its type.
   */
  item?: PinnedPromptItem;
  /**
   * Off: the page is not told to the spotlight, for a list whose open
   * item's own button tells it.
   */
  publish?: boolean;
  /**
   * Why no prompt may run on this item (#Q4471): the button is drawn
   * disabled, with this as its reason. The server refuses the run too.
   */
  blocked?: string;
}

/**
 * The robot button of a pinnable page (#Q4284), as core's slot (#E175):
 * Plan's and Ship's pages render it, and it draws what `@lore/prompts`
 * registered on {@link PinnedPromptsSlot}, or nothing at all while the slot
 * is unfilled or the project has the `prompts` capability off.
 */
const PinnedPromptsButton = (props: PinnedPromptsButtonProps) => {
  const Filled = useInject(PinnedPromptsSlot).Button;
  const [project] = useStore(currentProjectAtom);
  if (!Filled || !hasCapability(project, "prompts")) return null;
  return <Filled {...props} />;
};

export default PinnedPromptsButton;
