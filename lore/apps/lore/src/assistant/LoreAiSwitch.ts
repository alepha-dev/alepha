import { $env, $hook, $inject, Alepha, AlephaError, z } from "alepha";
import { AiProvider, MemoryAiProvider } from "alepha/ai";

/**
 * Whether the assistant is on, on this copy of Lore: the env var
 * `AI_ASSISTANT_ENABLED` (#Q3207).
 *
 * Unset, empty, `false` or `0`: off. Anything else: on. No copy turns it on by
 * default, production included: an operator sets it where it is wanted.
 *
 * The switch gates the endpoints, never the module. `LoreAssistant` stays
 * registered either way, so the `ai_*` tables and the generated migrations
 * never depend on an env var (`check:migrations` would flip with it).
 *
 * ⚠️ Off Workers no real provider is registered and `MemoryAiProvider`, a
 * scripted fake, would answer. A production copy with the switch set and that
 * fake behind it refuses to start, naming the switch, rather than serve a
 * chat that answers nothing.
 */
export class LoreAiSwitch {
  protected readonly alepha = $inject(Alepha);

  protected readonly env = $env(
    z.object({
      AI_ASSISTANT_ENABLED: z
        .text({
          default: "",
          secret: false,
          description:
            "Turns Lore's in-app assistant on. Unset, empty, 'false' or '0': off. On Workers the `ai` binding answers; elsewhere no provider exists and a production boot refuses.",
        })
        .optional(),
    }),
  );

  /**
   * Whether the assistant answers on this copy.
   */
  public get enabled(): boolean {
    const value = String(this.env.AI_ASSISTANT_ENABLED ?? "")
      .trim()
      .toLowerCase();
    return value !== "" && value !== "false" && value !== "0";
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (!this.enabled || !this.alepha.isProduction()) {
        return;
      }
      if (this.alepha.inject(AiProvider) instanceof MemoryAiProvider) {
        throw new AlephaError(
          "AI_ASSISTANT_ENABLED is set, but no AI provider is registered: off Workers Lore has none, and the in-memory fake would answer every turn. Unset AI_ASSISTANT_ENABLED, or run on Workers with the `ai` binding.",
        );
      }
    },
  });
}
