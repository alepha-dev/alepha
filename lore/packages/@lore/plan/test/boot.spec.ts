import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreCoreWeb } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LorePlanApi } from "../src/api/index.ts";
import { LorePlanMcp } from "../src/mcp/index.ts";
import { LorePlanWeb } from "../src/web/index.ts";

/**
 * `@lore/plan` boots as core plus work, which is the whole point of the
 * package boundary: every module depends on core and on nothing else.
 */
describe("@lore/plan", () => {
  it("boots as core plus work", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LoreCoreApi)
      .with(LoreCoreMcp)
      .with(LoreCoreWeb)
      .with(LorePlanApi)
      .with(LorePlanMcp)
      .with(LorePlanWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
