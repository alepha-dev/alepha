import { I18n } from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import { ToolTrace } from "../services/toolTrace.ts";
import ChatAgentTrace, { type ChatAgentTraceProps } from "./ChatAgentTrace.tsx";

/**
 * The summary over an agent's answer: calls counted by what they touched,
 * reads and writes apart, a failed call left out.
 */
describe("ChatAgentTrace", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (tools: ChatAgentTraceProps["tools"]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(ToolTrace);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <ChatAgentTrace tools={tools} label={(name) => name} />
      </AlephaContext.Provider>,
    );
    return screen.getByTestId("chat-agent-trace").textContent;
  };

  it("counts reads by kind, in the order first used", async ({ expect }) => {
    const text = await mount([
      { name: "quest_list", state: "done" },
      { name: "quest_get", state: "done" },
      { name: "folio_search", state: "done" },
      { name: "quest_get", state: "done" },
    ]);

    expect(text).toContain("Read 3 quests, 1 folio");
  });

  it("says what it changed apart from what it read", async ({ expect }) => {
    const text = await mount([
      { name: "project_info", state: "done" },
      { name: "quest_create", state: "done" },
      { name: "folio_get", state: "failed" },
    ]);

    expect(text).toContain("Read the project, changed 1 quest");
  });
});
