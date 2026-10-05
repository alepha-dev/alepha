import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreCoreWeb } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreWorkApi } from "../src/api/index.ts";
import { LoreWorkMcp } from "../src/mcp/index.ts";
import { LoreWorkWeb } from "../src/web/index.ts";

/**
 * `@lore/work` boots as core plus work, which is the whole point of the
 * package boundary: every module depends on core and on nothing else.
 */
describe("@lore/work", () => {
  it("boots as core plus work", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LoreCoreApi)
      .with(LoreCoreMcp)
      .with(LoreCoreWeb)
      .with(LoreWorkApi)
      .with(LoreWorkMcp)
      .with(LoreWorkWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
