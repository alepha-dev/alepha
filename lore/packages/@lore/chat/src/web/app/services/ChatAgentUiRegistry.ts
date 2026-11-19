import type { AiChatConfirmCardProps, AiChatToolLabel } from "@alepha/ui/ai";
import type { ComponentType } from "react";

/**
 * How an agent's answer reads in a room (#E161, #Q3956): a label per tool
 * for the trace line, and a confirmation card per write.
 *
 * They are the assistant's, which lives in the app because its tools span
 * every package; `@lore/chat` imports core only, so the app registers its
 * existing labels and cards here at boot. A tool with no card gets the
 * framework's generic one, and one with no label its name.
 */
export class ChatAgentUiRegistry {
  protected readonly cards = new Map<
    string,
    ComponentType<AiChatConfirmCardProps>
  >();
  protected labelHook: () => AiChatToolLabel = () => (name) => name;

  public register(contribution: {
    cards?: Record<string, ComponentType<AiChatConfirmCardProps>>;
    /**
     * A hook returning the labeller: it may read the language.
     */
    useToolLabel?: () => AiChatToolLabel;
  }): void {
    for (const [name, card] of Object.entries(contribution.cards ?? {})) {
      this.cards.set(name, card);
    }
    if (contribution.useToolLabel) {
      this.labelHook = contribution.useToolLabel;
    }
  }

  public card(name: string): ComponentType<AiChatConfirmCardProps> | undefined {
    return this.cards.get(name);
  }

  /**
   * The registered labeller's hook: set at boot, so the same hook runs on
   * every render.
   */
  public toolLabelHook(): () => AiChatToolLabel {
    return this.labelHook;
  }
}
