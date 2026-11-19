import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreCoreWeb } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreBuildApi } from "../src/api/index.ts";
import { LoreBuildMcp } from "../src/mcp/index.ts";
import { LoreBuildWeb } from "../src/web/index.ts";

/**
 * `@lore/build` boots as core plus build: every module depends on core and on
 * nothing else.
 */
describe("@lore/build", () => {
  it("boots as core plus build", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LoreCoreApi)
      .with(LoreCoreMcp)
      .with(LoreCoreWeb)
      .with(LoreBuildApi)
      .with(LoreBuildMcp)
      .with(LoreBuildWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
