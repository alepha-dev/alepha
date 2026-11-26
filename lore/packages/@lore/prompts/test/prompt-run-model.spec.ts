import { AGENT_MODELS } from "@lore/core/schemas";
import { describe, it } from "vitest";

import { PromptRunService } from "../src/api/services/PromptRunService.ts";

/**
 * A run's model (#Q4504): a family alias of the one shared list is its
 * latest id, on the server as in the run dialog.
 */
describe("PromptRunService.modelOf", () => {
  it("resolves a family alias to its latest id, for the run's agent or any", ({
    expect,
  }) => {
    const opus = AGENT_MODELS.claude!.find((it) => it.alias === "claude-opus")!;
    expect(PromptRunService.modelOf("claude", "claude-opus")).toBe(opus.model);
    expect(PromptRunService.modelOf(undefined, "claude-opus")).toBe(opus.model);
    expect(PromptRunService.modelOf("gemini", "gemini-pro")).toBe(
      "gemini-2.5-pro",
    );
  });

  it("keeps an id, a name it does not know and an absent model as given", ({
    expect,
  }) => {
    expect(PromptRunService.modelOf("claude", "claude-opus-5-5")).toBe(
      "claude-opus-5-5",
    );
    expect(PromptRunService.modelOf("claude", "sonnet")).toBe("sonnet");
    expect(PromptRunService.modelOf("gemini", "claude-opus")).toBe(
      "claude-opus",
    );
    expect(PromptRunService.modelOf("claude", undefined)).toBeUndefined();
  });
});
