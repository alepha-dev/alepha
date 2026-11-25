import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LorePromptsApi } from "../src/api/index.ts";
import { LorePromptsMcp } from "../src/mcp/index.ts";
import { LorePromptsWeb } from "../src/web/index.ts";

/**
 * `@lore/prompts` (#E175) boots on its own, core first, as every package does.
 */
describe("@lore/prompts", () => {
  it("boots its three modules on top of core", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LorePromptsApi)
      .with(LorePromptsMcp)
      .with(LorePromptsWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
