import { $module, type Alepha } from "alepha";
import { AiProvider, AlephaAi } from "alepha/ai";

import { WorkersAiProvider } from "./providers/WorkersAiProvider.ts";
import { WorkersAiBinding } from "./services/WorkersAiBinding.ts";

// Exports
export * from "./providers/WorkersAiProvider.ts";
export * from "./services/WorkersAiBinding.ts";

/**
 * Plugin for Alepha AI that runs models on the Workers AI binding
 * (`env.AI`): no API key, no HTTP.
 *
 * On Workers, registering it makes `WorkersAiProvider` the `AiProvider`, and
 * the Cloudflare build declares the `ai` binding. Off Workers (`yarn dev` on
 * Node, the specs) it registers only the binding declaration, so the
 * provider is whatever the next vendor module substitutes
 * (`AlephaAiOpenai` on Workers AI's REST endpoint reaches the same models),
 * or `MemoryAiProvider` without one.
 *
 * ⚠️ Register it BEFORE another vendor module: the first substitution wins,
 * which is what lets the binding answer on Workers and the other vendor
 * everywhere else.
 *
 * @see {@link WorkersAiProvider}
 * @module alepha.ai.cloudflare
 */
export const AlephaAiCloudflare = $module({
  name: "alepha.ai.cloudflare",
  services: [WorkersAiBinding],
  variants: [WorkersAiProvider],
  // Off Workers, NOT `alepha.with(AlephaAi)`: registering it there would fix
  // `MemoryAiProvider` as the provider before a vendor module registered
  // after this one could substitute its own.
  register: (alepha: Alepha) => {
    if (alepha.isServerless()) {
      alepha.with({
        optional: true,
        provide: AiProvider,
        use: WorkersAiProvider,
      });
      alepha.with(AlephaAi);
      alepha.inject(WorkersAiProvider);
    }
  },
});
