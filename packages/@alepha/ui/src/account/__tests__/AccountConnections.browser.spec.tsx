import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { MyConnection } from "alepha/api/users";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import AccountConnections from "../AccountConnections.tsx";

const connection = (id: string, clientName: string): MyConnection => ({
  id,
  clientId: id,
  clientName,
  createdAt: "2026-09-01T10:00:00.000Z",
  expiresAt: "2027-03-01T10:00:00.000Z",
  sessionCount: 1,
  current: false,
});

/**
 * Records a disconnect.
 */
class Links extends LinkProvider {
  public revoked: string[] = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "revokeMyConnection") {
              this.revoked.push(input.params.id);
            }
            return undefined;
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

/**
 * Connected apps as a `DataTable`: a row per app, today's copy when there is
 * none, and a disconnect that confirms, calls the API and removes the row.
 */
describe("AccountConnections", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (connections: MyConnection[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AccountConnections connections={connections} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return alepha.inject(Links);
  };

  const names = () =>
    screen
      .queryAllByTestId("account-connection-name")
      .map((cell) => cell.textContent);

  it("renders a row per connected app", async () => {
    await mount([
      connection("mcp_1", "Claude"),
      connection("mcp_2", "Deploy CLI"),
    ]);

    await waitFor(() => expect(names()).toHaveLength(2));
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Deploy CLI")).toBeTruthy();
  });

  it("keeps today's copy when nothing is connected", async () => {
    await mount([]);

    expect(await screen.findByText("Nothing is connected")).toBeTruthy();
    expect(
      screen.getByText(/Applications you authorize will appear here\./),
    ).toBeTruthy();
  });

  it("confirms a disconnect, then removes the row", async () => {
    const links = await mount([
      connection("mcp_1", "Claude"),
      connection("mcp_2", "Deploy CLI"),
    ]);

    const row = (await screen.findByText("Claude")).closest("tr")!;
    fireEvent.click(row.querySelector('[aria-label="Open row actions"]')!);
    const entry = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent?.includes("Disconnect"),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(entry);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(links.revoked).toEqual(["mcp_1"]));
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(screen.queryByText("Claude")).toBeNull();
  });
});
