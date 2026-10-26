import { Alepha, run } from "alepha";
import { AlephaAiCloudflare } from "alepha/ai/cloudflare";
import { AlephaAiOpenai } from "alepha/ai/openai";
import { SecurityProvider } from "alepha/security";

import { DemoSecurityProvider } from "./api/DemoSecurityProvider.ts";
import { E2eScript } from "./api/E2eScript.ts";
import { AiExampleApi } from "./api/index.ts";
import { AiExampleWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "AI example",
  },
});

alepha.with({ provide: SecurityProvider, use: DemoSecurityProvider });

// The vendor is the module registered, and the FIRST substitution wins, so
// the vendor modules come before `AlephaApiAi` (inside `AiExampleApi`):
// - on Workers, `AlephaAiCloudflare` answers through the `env.AI` binding
//   (and elsewhere registers only what the build needs to declare it);
// - on Node (Docker), `AlephaAiOpenai` reaches the same Workers AI models
//   over REST, when `AI_BASE_URL` points it there;
// - with neither, `MemoryAiProvider` answers, which is what the e2e scripts.
alepha.with(AlephaAiCloudflare);
if (alepha.env.AI_BASE_URL) {
  alepha.with(AlephaAiOpenai);
}
if (alepha.env.AI_E2E) {
  alepha.with(E2eScript);
}

alepha.with(AiExampleApi);
alepha.with(AiExampleWeb);

run(alepha);
