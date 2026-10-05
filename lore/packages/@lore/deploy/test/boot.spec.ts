import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreCoreWeb } from "@lore/core/web";
import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import { LoreDeployMcp } from "../src/mcp/index.ts";
import { LoreDeployWeb } from "../src/web/index.ts";

/**
 * `@lore/deploy` boots as core plus deploy, which is the whole point of the
 * package boundary: every module depends on core and on nothing else.
 */
describe("@lore/deploy", () => {
  it("boots as core plus deploy", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(LoreCoreApi)
      .with(LoreCoreMcp)
      .with(LoreCoreWeb)
      .with(LoreDeployApi)
      .with(LoreDeployMcp)
      .with(LoreDeployWeb);

    await alepha.start();

    expect(alepha.isStarted()).toBe(true);
    await alepha.stop();
  });
});
