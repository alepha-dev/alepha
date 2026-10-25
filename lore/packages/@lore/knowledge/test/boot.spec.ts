import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreCoreWeb } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreKnowledgeApi } from "../src/api/index.ts";
import { LoreKnowledgeMcp } from "../src/mcp/index.ts";
import { LoreKnowledgeWeb } from "../src/web/index.ts";

/**
 * `@lore/knowledge` boots as core plus knowledge, which is the whole point of the
 * package boundary: every module depends on core and on nothing else.
 */
describe("@lore/knowledge", () => {
  it("boots as core plus knowledge", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LoreCoreApi)
      .with(LoreCoreMcp)
      .with(LoreCoreWeb)
      .with(LoreKnowledgeApi)
      .with(LoreKnowledgeMcp)
      .with(LoreKnowledgeWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
