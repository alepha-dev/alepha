import { $module, type Alepha } from "alepha";
import { AiProvider, AlephaAi } from "alepha/ai";

import { WorkersAiProvider } from "./providers/WorkersAiProvider.ts";

// Exports
export * from "./providers/WorkersAiProvider.ts";

/**
 * Plugin for Alepha AI that runs models on the Workers AI binding
 * (`env.AI`): no API key, no HTTP.
 *
 * On Workers, registering it makes `WorkersAiProvider` the `AiProvider`, and
 * the Cloudflare build declares the `ai` binding. Off Workers (`yarn dev` on
 * Node, the specs) it substitutes nothing, so the app falls back to
 * `AlephaAi`'s default, or to another vendor module registered beside it
 * (`AlephaAiOpenai` on Workers AI's REST endpoint, for the same models).
 *
 * @see {@link WorkersAiProvider}
 * @module alepha.ai.cloudflare
 */
export const AlephaAiCloudflare = $module({
  name: "alepha.ai.cloudflare",
  services: [WorkersAiProvider],
  // Gated on `isServerless()` like `AlephaEmailCloudflare`: the build must
  // see the service to emit the binding, but the substitution may only
  // happen where the binding exists.
  register: (alepha: Alepha) => {
    if (alepha.isServerless()) {
      alepha.with({
        optional: true,
        provide: AiProvider,
        use: WorkersAiProvider,
      });
    }
    return alepha.with(AlephaAi);
  },
});
