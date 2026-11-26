import { I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import NewRoomDialog from "./NewRoomDialog.tsx";

/**
 * What each createChatRoom call sent.
 */
const sent: Array<{ name: string; private: boolean }> = [];

class FakeLinks extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(
            async (input: any) => {
              if (name !== "createChatRoom") return undefined;
              sent.push(input.body);
              return {
                id: crypto.randomUUID(),
                projectId: 1,
                name: input.body.name,
                private: input.body.private,
                createdAt: "2026-11-26T10:00:00.000Z",
                memberCount: 1,
                joined: true,
              };
            },
            { can: () => true },
          ),
      },
    );
  }
}

/**
 * The New room dialog (#Q4484): a Visibility select, Public by default,
 * sent to createChatRoom as its `private` flag.
 */
describe("NewRoomDialog", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    sent.length = 0;
  });

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <NewRoomDialog
          open
          projectId={1}
          onOpenChange={() => {}}
          onCreated={() => {}}
        />
      </AlephaContext.Provider>,
    );
    return screen.findByTestId("chat-new-room-form");
  };

  it("creates a public room by default, with no Private switch", async ({
    expect,
  }) => {
    const form = await mount();
    expect(screen.queryByRole("switch")).toBeNull();
    const visibility = screen.getByTestId("chat-new-room-visibility");
    expect(visibility.textContent).toContain("Public");
    expect(form.textContent).toContain("Visibility");

    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), {
      target: { value: "release-1-0" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ name: "release-1-0", private: false });
  });

  it("creates a private room when Private is picked", async ({ expect }) => {
    const form = await mount();
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), {
      target: { value: "secret" },
    });
    const visibility = screen.getByTestId("chat-new-room-visibility");
    fireEvent.keyDown(visibility, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Private" }));
    await waitFor(() => expect(visibility.textContent).toContain("Private"));
    fireEvent.submit(form);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ name: "secret", private: true });
  });
});
