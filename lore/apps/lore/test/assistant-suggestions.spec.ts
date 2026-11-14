import { AssistantSuggestionRegistry } from "@lore/core/web";
import { WorkShell } from "@lore/plan/web";
import { DeployShell } from "@lore/ship/web";
import { Alepha } from "alepha";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

/**
 * The assistant's prompts on Lore's pages (#Q3585), as the modules register
 * them at boot: a quest, an epic, the Apps pages and the feedback inbox each
 * have their own, and any other page keeps the generic set. Reports is
 * core's, pinned by `assistant-suggestion-registry.spec.ts` in core.
 */
describe("assistant suggestions per page", () => {
  const boot = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AssistantSuggestionRegistry);
    alepha.inject(WorkShell);
    alepha.inject(DeployShell);
    await alepha.start();
    return alepha.inject(AssistantSuggestionRegistry);
  };

  const at = (...names: string[]) => ["layout", "project", ...names];

  it("offers each page's own prompts", async ({ expect }) => {
    const registry = await boot();

    expect(registry.suggestionsFor(at("projectQuest"))?.[0]).toBe(
      "assistant.suggest.quest.left",
    );
    expect(registry.suggestionsFor(at("projectEpic"))?.[0]).toBe(
      "assistant.suggest.epic.lack",
    );
    expect(registry.suggestionsFor(at("projectFeedback"))?.[0]).toBe(
      "assistant.suggest.feedback.pending",
    );
    expect(registry.suggestionsFor(at("projectApps"))?.[0]).toBe(
      "assistant.suggest.apps.deploys",
    );
    expect(registry.suggestionsFor(at("projectApp", "appVitals"))?.[0]).toBe(
      "assistant.suggest.apps.deploys",
    );
  });

  it("leaves a page nobody registered to the panel's generic set", async ({
    expect,
  }) => {
    const registry = await boot();
    expect(registry.suggestionsFor(at("projectSettings"))).toBeUndefined();
  });
});
