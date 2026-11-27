import { DialogProvider } from "@alepha/ui";
import { ElementReferenceRegistry, I18n } from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

import type { ChatMessageResource } from "../../../schemas/index.ts";
import ChatMessageRow from "./ChatMessageRow.tsx";

const AGENT = crypto.randomUUID();

/**
 * The page a mention chip links to.
 */
class Routes {
  members = $page({
    name: "projectSettingsMembers",
    path: "/:projectSlug/settings/members",
    component: () => null,
  });
}

const answer = (
  extra: Partial<ChatMessageResource> = {},
): ChatMessageResource => ({
  id: crypto.randomUUID(),
  roomId: crypto.randomUUID(),
  createdAt: "2026-11-23T12:00:00.000Z",
  agent: "jarvis",
  agentId: AGENT,
  agentName: "Jarvis",
  body: "All checked.",
  mentions: [],
  references: [],
  reactions: [],
  attachments: [],
  ...extra,
});

/**
 * A project agent's answer in the room (#E170, #Q4198): its name, its
 * picture or its initials, and the agent badge, read from the agent's row,
 * so a renamed or deleted agent's past answers still show who it was.
 */
describe("ChatMessageRow, an agent's answer", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (message: ChatMessageResource, author: string) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    // What `LoreViewer` reads, injected before the container locks.
    alepha.inject(ElementReferenceRegistry);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ChatMessageRow
            message={message}
            author={author}
            continued={false}
            mentionsMe={false}
            projectId={1}
            projectSlug="acme"
            handles={[{ name: "jarvis" }]}
            canEdit={false}
            canDelete={false}
            onEdit={async () => true}
            onDelete={async () => {}}
            nameOf={() => ""}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("shows the agent's name, its initials and the robot mark", async ({
    expect,
  }) => {
    await mount(answer(), "Jarvis");

    expect(screen.getByText("Jarvis")).toBeTruthy();
    // A small icon named "Agent", no longer a pill reading "agent".
    const mark = screen.getByRole("img", { name: "Agent" });
    expect(mark.getAttribute("title")).toBe("Agent");
    expect(screen.queryByText("agent")).toBeNull();
    expect(screen.getByTestId("chat-agent-initials").textContent).toBe("JA");
  });

  it("draws the agent's picture when it has one", async ({ expect }) => {
    const avatar = crypto.randomUUID();
    await mount(answer({ agentAvatarId: avatar }), "Jarvis");

    const image = screen.getByTestId("chat-agent-avatar").querySelector("img");
    expect(image?.getAttribute("src")).toContain(avatar);
  });

  it("keeps a deleted agent's name and picture on its past answers", async ({
    expect,
  }) => {
    // A deleted agent's row is kept: the server still names it.
    await mount(answer({ agentName: "Old Jarvis" }), "Old Jarvis");

    expect(screen.getByText("Old Jarvis")).toBeTruthy();
    expect(screen.getByTestId("chat-agent-initials").textContent).toBe("OJ");
  });

  it("draws the built-in agent as the bot", async ({ expect }) => {
    await mount(
      answer({ agent: "lore", agentId: undefined, agentName: undefined }),
      "Lore",
    );

    expect(screen.getByText("Lore")).toBeTruthy();
    expect(screen.queryByTestId("chat-agent-initials")).toBeNull();
  });

  it("renders a mention of an agent as a mention chip", async ({ expect }) => {
    await mount(
      answer({
        agent: undefined,
        agentId: undefined,
        agentName: undefined,
        authorId: crypto.randomUUID(),
        body: "@jarvis time to check",
      }),
      "Ada",
    );

    const chip = screen.getByText("@jarvis");
    expect(chip.closest("a")?.getAttribute("href")).toContain("?mention=");
  });
});
