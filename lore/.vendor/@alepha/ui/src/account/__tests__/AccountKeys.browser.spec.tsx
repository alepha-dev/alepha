import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { ApiKeyOptionsResponse, ListApiKeyItem } from "alepha/api/keys";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import AccountKeys from "../AccountKeys.tsx";

const CI = "00000000-0000-4000-8000-000000000011";
const DEPLOY = "00000000-0000-4000-8000-000000000012";
const OLD = "00000000-0000-4000-8000-000000000013";

const key = (
  id: string,
  name: string,
  status: ListApiKeyItem["status"],
): ListApiKeyItem => ({
  id,
  name,
  tokenPrefix: "ak_",
  tokenSuffix: id.slice(-4),
  roles: ["user"],
  permissions: [],
  ipAllowlist: [],
  createdAt: "2026-09-01T10:00:00.000Z",
  usageCount: 0,
  status,
  ...(status === "revoked" ? { revokedAt: "2026-09-10T10:00:00.000Z" } : {}),
});

const OPTIONS: ApiKeyOptionsResponse = {
  expiry: { default: "90d", maxDays: 0, presets: ["7d", "90d", "never"] },
  permissions: { groups: [] },
};

/**
 * Stands in for the keys API: records a revoke, and lists the keys with the
 * revoked one marked.
 */
class Links extends LinkProvider {
  public revoked: string[] = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "revokeMyApiKey") {
              this.revoked.push(input.params.id);
              return;
            }
            if (name === "listApiKeys") {
              return [
                key(CI, "CI", this.revoked.includes(CI) ? "revoked" : "active"),
                key(DEPLOY, "Deploy", "active"),
                key(OLD, "Old laptop", "revoked"),
              ];
            }
            if (name === "getApiKeyOptions") {
              return OPTIONS;
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
 * API keys as a `DataTable`: the live keys by default, a create button that
 * opens the existing dialog, and a revoke that confirms, calls the API and
 * re-reads the list, so the revoked key leaves the live view.
 */
describe("AccountKeys", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
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
          <AccountKeys
            apiKeys={[
              key(CI, "CI", "active"),
              key(DEPLOY, "Deploy", "active"),
              key(OLD, "Old laptop", "revoked"),
            ]}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Deploy");
    return alepha.inject(Links);
  };

  const names = () =>
    screen.queryAllByTestId("account-key-name").map((cell) => cell.textContent);

  it("lists the live keys, not the revoked one", async () => {
    await mount();

    expect(names()).toEqual(expect.arrayContaining(["CI", "Deploy"]));
    expect(names()).not.toContain("Old laptop");
  });

  it("opens the create dialog from the toolbar", async () => {
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "New key" }));

    expect(await screen.findByText("New API key")).toBeTruthy();
  });

  it("confirms a revoke, calls the API and drops the key from the live view", async () => {
    const links = await mount();

    const row = screen.getByText("CI").closest("tr")!;
    fireEvent.click(row.querySelector('[aria-label="Open row actions"]')!);
    const entry = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent?.includes("Revoke"),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(entry);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(links.revoked).toEqual([CI]));
    await waitFor(() => expect(names()).toEqual(["Deploy"]));
  });
});
