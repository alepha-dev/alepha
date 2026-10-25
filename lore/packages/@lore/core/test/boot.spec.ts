import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import { LoreCoreMcp } from "../src/mcp/index.ts";
import { LoreCoreWeb } from "../src/web/index.ts";

/**
 * `@lore/core` boots as core alone, which is the whole point of the
 * package boundary: every module depends on core and on nothing else.
 */
describe("@lore/core", () => {
  it("boots as core alone", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LoreCoreApi)
      .with(LoreCoreMcp)
      .with(LoreCoreWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
