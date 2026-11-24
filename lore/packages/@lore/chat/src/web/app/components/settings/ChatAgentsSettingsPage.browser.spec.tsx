import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  preloadMarkdownEditor,
} from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { ValidationError } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import type { ChatAgentResource } from "../../../../api/schemas/chatAgentResourceSchema.ts";
import ChatAgentsSettingsPage from "./ChatAgentsSettingsPage.tsx";

// The lazy editor chunk, loaded before any spec waits on the dialog.
preloadMarkdownEditor();

const JARVIS: ChatAgentResource = {
  id: crypto.randomUUID(),
  handle: "jarvis",
  name: "Jarvis",
  builtin: false,
  model: "claude-haiku-5-5",
  prePrompt: "Check things.",
};
const LORE: ChatAgentResource = {
  id: "lore",
  handle: "lore",
  name: "Lore",
  builtin: true,
};

/**
 * Stands in for the HTTP client (never `vi.mock`): the list, and a create
 * that refuses `lore` on its field as the server does.
 */
class FakeLinkProvider extends LinkProvider {
  public static enabled = true;
  public static items: ChatAgentResource[] = [LORE, JARVIS];
  public created: unknown[] = [];
  public deleted: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listChatAgents: async () => ({
        items: FakeLinkProvider.items,
        enabled: FakeLinkProvider.enabled,
      }),
      getProjectUsers: async () => [],
      getChatAgent: async () => JARVIS,
      getChatAgentBudget: async () => ({
        tokens: 50_000,
        spent: 12_500,
        windowHours: 24,
      }),
      createChatAgent: async (config: { body: { handle: string } }) => {
        if (config.body.handle === "lore") {
          const message = "@lore is the built-in agent";
          throw new ValidationError(
            { part: "body", issues: [{ path: "/handle", message }] },
            { message },
          );
        }
        this.created.push(config.body);
        return { ...JARVIS, ...config.body };
      },
      deleteChatAgent: async (config: { params: { agentId: string } }) => {
        this.deleted.push(config.params.agentId);
        return { ok: true };
      },
    });
  }
}

describe("Settings > Chat > Agents", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    FakeLinkProvider.enabled = true;
    FakeLinkProvider.items = [LORE, JARVIS];
  });

  const mount = async (permissions: string[] = ["*"]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: ["chat"], permissions }),
    );
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ChatAgentsSettingsPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findAllByTestId("chat-agent-row");
    return alepha.inject(FakeLinkProvider);
  };

  it("lists lore and the project's agents, with their model", async ({
    expect,
  }) => {
    await mount();

    const rows = screen.getAllByTestId("chat-agent-row");
    expect(rows.map((it) => it.getAttribute("data-handle"))).toEqual([
      "lore",
      "jarvis",
    ]);
    expect(rows[0]!.textContent).toContain("built-in");
    expect(rows[1]!.textContent).toContain("claude-haiku-5-5");
  });

  it("shows the project's AI budget for agents and what it spent (#Q4237)", async ({
    expect,
  }) => {
    await mount();

    const spent = await screen.findByTestId("chat-agent-budget-spent");
    expect(spent.textContent).toContain(
      "12,500 of 50,000 tokens spent over the last 24 hours.",
    );
    expect(screen.getByTestId("chat-agent-budget-tokens")).toBeTruthy();
  });

  it("hides create, edit and delete without chat:agent", async ({ expect }) => {
    await mount(["project:read", "chat:read", "chat:write"]);

    expect(screen.queryByTestId("chat-agent-create")).toBeNull();
    expect(screen.queryByTestId("chat-agent-edit")).toBeNull();
    expect(screen.queryByTestId("chat-agent-delete")).toBeNull();
    // The budget is read, not set.
    await screen.findByTestId("chat-agent-budget-spent");
    expect(screen.queryByTestId("chat-agent-budget-tokens")).toBeNull();
  });

  it("shows a refused handle under its field", async ({ expect }) => {
    const fake = await mount();

    fireEvent.click(screen.getByTestId("chat-agent-create"));
    const handle = (
      await screen.findByTestId("chat-agent-handle")
    ).querySelector("input")!;
    fireEvent.change(handle, { target: { value: "lore" } });
    fireEvent.change(
      screen.getByTestId("chat-agent-name").querySelector("input")!,
      { target: { value: "Lore two" } },
    );
    fireEvent.click(screen.getByTestId("chat-agent-save"));

    await waitFor(() =>
      expect(screen.getByTestId("chat-agent-handle").textContent).toContain(
        "@lore is the built-in agent",
      ),
    );
    expect(fake.created).toEqual([]);
  });

  it("asks before deleting, saying past answers stay and the handle is freed", async ({
    expect,
  }) => {
    const fake = await mount();

    fireEvent.click(screen.getByTestId("chat-agent-delete"));
    const confirm = await screen.findByText(/Its past answers keep showing/);
    expect(confirm).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(fake.deleted).toEqual([JARVIS.id]));
  });

  it("says so with AI off, and explains an empty list with a docs link", async ({
    expect,
  }) => {
    FakeLinkProvider.enabled = false;
    FakeLinkProvider.items = [{ ...JARVIS }];
    await mount();
    expect(screen.getByTestId("chat-agents-ai-off")).toBeTruthy();

    await alepha!.stop();
    alepha = undefined;
    document.body.innerHTML = "";
    FakeLinkProvider.items = [LORE];
    FakeLinkProvider.enabled = true;
    await mount();
    const empty = screen.getByTestId("chat-agents-empty");
    expect(empty.querySelector("a")?.getAttribute("href")).toBe(
      "https://alepha.dev/lore/docs/project-chat-agents",
    );
  });
});
