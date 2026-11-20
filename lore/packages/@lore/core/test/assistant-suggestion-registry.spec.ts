import { Alepha } from "alepha";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { CoreWebBoot } from "../src/web/app/CoreWebBoot.ts";
import { AssistantSuggestionRegistry } from "../src/web/app/registries/AssistantSuggestionRegistry.ts";

/**
 * The assistant's prompts per page (#Q3585): each module registers its own
 * pages' suggestions, the open page is matched from its deepest route layer
 * up, and a page nobody registered gets nothing, so the panel keeps its
 * generic set.
 */
describe("AssistantSuggestionRegistry", () => {
  const registry = () => {
    const it = new AssistantSuggestionRegistry();
    it.register({
      routes: (name) => name === "projectApp",
      keys: ["apps.one"],
    });
    it.register({
      routes: (name) => name === "projectEpic",
      keys: ["epic.one", "epic.two"],
    });
    return it;
  };

  it("answers the keys of the entry claiming the open page", ({ expect }) => {
    expect(
      registry().suggestionsFor(["layout", "project", "projectEpic"]),
    ).toEqual(["epic.one", "epic.two"]);
  });

  it("walks up from the deepest layer, so an app's tab finds its layout's", ({
    expect,
  }) => {
    expect(
      registry().suggestionsFor([
        "layout",
        "project",
        "projectApp",
        "appVitals",
      ]),
    ).toEqual(["apps.one"]);
  });

  it("answers nothing for a page no module registered", ({ expect }) => {
    expect(
      registry().suggestionsFor(["layout", "project", "projectSettings"]),
    ).toBeUndefined();
  });

  it("gives every tab of Reports core's own prompts", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(CoreWebBoot);
    await alepha.start();

    expect(
      alepha
        .inject(AssistantSuggestionRegistry)
        .suggestionsFor([
          "layout",
          "project",
          "projectReports",
          "reportsQuality",
        ]),
    ).toEqual([
      "assistant.suggest.reports.week",
      "assistant.suggest.reports.slow",
      "assistant.suggest.reports.summary",
    ]);
  });
});
