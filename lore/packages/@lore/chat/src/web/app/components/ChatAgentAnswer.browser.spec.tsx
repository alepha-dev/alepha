import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import type { ChatMessageResource } from "../../../schemas/index.ts";
import { ChatAgentUiRegistry } from "../services/ChatAgentUiRegistry.ts";
import { ToolTrace } from "../services/toolTrace.ts";
import ChatAgentAnswer from "./ChatAgentAnswer.tsx";

const MENTIONER = crypto.randomUUID();

const paused: ChatMessageResource = {
  id: crypto.randomUUID(),
  roomId: crypto.randomUUID(),
  createdAt: "2026-11-19T12:00:00.000Z",
  agent: "lore",
  body: "I can file it.",
  mentions: [],
  references: [],
  reactions: [],
  attachments: [],
  agentRun: {
    status: "paused",
    mentionerId: MENTIONER,
    tool: "quest_create",
    input: { title: "From chat" },
    tools: [
      { name: "quest_list", state: "done" },
      { name: "quest_create", state: "running" },
    ],
  },
};

/**
 * An agent's answer in a room (#E161, #Q3956): the trace of its tools, and
 * the card of the write it waits on, which only its mentioner can press.
 */
describe("ChatAgentAnswer", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (me: string) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(ToolTrace);
    alepha.inject(ChatAgentUiRegistry).register({
      useToolLabel: () => (name, state) =>
        name === "quest_list" && state === "done" ? "Listed quests" : undefined,
    });
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <ChatAgentAnswer
          message={paused}
          me={me}
          mentioner="Ada"
          deciding={false}
          onDecide={() => {}}
          part="trace"
        />
        <ChatAgentAnswer
          message={paused}
          me={me}
          mentioner="Ada"
          deciding={false}
          onDecide={() => {}}
          part="after"
        />
      </AlephaContext.Provider>,
    );
  };

  it("names the running tool, and opens on every step", async ({ expect }) => {
    await mount(MENTIONER);

    const trace = screen.getByTestId("chat-agent-trace");
    expect(trace.textContent).toContain("quest_create");
    expect(screen.queryByTestId("ai-chat-tool-trace-steps")).toBeNull();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const steps = screen.getByTestId("ai-chat-tool-trace-steps").textContent;
    expect(steps).toContain("Listed quests");
    expect(steps).toContain("quest_create");
  });

  it("lets the mentioner press the card", async ({ expect }) => {
    await mount(MENTIONER);

    const buttons = screen
      .getByTestId("chat-agent-card")
      .querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect([...buttons].every((button) => !button.matches(":disabled"))).toBe(
      true,
    );
  });

  it("shows anyone else the card, disabled, and who decides", async ({
    expect,
  }) => {
    await mount(crypto.randomUUID());

    const card = screen.getByTestId("chat-agent-card");
    expect(
      [...card.querySelectorAll("button")].every((button) =>
        button.matches(":disabled"),
      ),
    ).toBe(true);
    expect(card.textContent).toContain("Waiting for Ada to decide.");
  });
});
