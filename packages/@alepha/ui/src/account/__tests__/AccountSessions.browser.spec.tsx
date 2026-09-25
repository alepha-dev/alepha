import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { MySession } from "alepha/api/users";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import AccountSessions from "../AccountSessions.tsx";

const CURRENT = "00000000-0000-4000-8000-000000000001";
const LAPTOP = "00000000-0000-4000-8000-000000000002";
const PHONE = "00000000-0000-4000-8000-000000000003";

const sessions: MySession[] = [
  {
    id: CURRENT,
    createdAt: "2026-09-20T10:00:00.000Z",
    expiresAt: "2026-10-20T10:00:00.000Z",
    ip: "10.0.0.1",
    userAgent: { browser: "Firefox", os: "Linux", device: "DESKTOP" },
    current: true,
  },
  {
    id: LAPTOP,
    createdAt: "2026-09-01T10:00:00.000Z",
    expiresAt: "2026-10-01T10:00:00.000Z",
    lastUsedAt: "2026-09-24T10:00:00.000Z",
    ip: "10.0.0.2",
    userAgent: { browser: "Chrome", os: "macOS", device: "DESKTOP" },
    current: false,
  },
  {
    id: PHONE,
    createdAt: "2026-09-02T10:00:00.000Z",
    expiresAt: "2026-10-02T10:00:00.000Z",
    ip: "10.0.0.3",
    userAgent: { browser: "Safari", os: "iOS", device: "MOBILE" },
    current: false,
  },
];

/**
 * Records the two writes the page makes, and answers them.
 */
class Links extends LinkProvider {
  public deleted: string[] = [];
  public deletedOthers = 0;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "deleteMySession") {
              this.deleted.push(input.params.id);
              return;
            }
            if (name === "deleteMyOtherSessions") {
              this.deletedOthers += 1;
              return { revoked: 2 };
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
 * Sessions as a `DataTable`: a row per session, the current one marked and
 * not revocable from its row, and a revoke that confirms, calls the API and
 * takes the row out of the table.
 */
describe("AccountSessions", () => {
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
          <AccountSessions sessions={sessions} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Chrome on macOS");
    return alepha.inject(Links);
  };

  /** The table body's rows, the device cell's text each. */
  const devices = () =>
    screen
      .getAllByTestId("account-session-device")
      .map((cell) => cell.textContent);

  const clickMenuItem = async (label: string) => {
    const entry = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent?.includes(label),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(entry);
  };

  const confirmDialog = async (label: string) => {
    const button = await screen.findByRole("button", { name: label });
    fireEvent.click(button);
  };

  it("renders a row per session", async () => {
    await mount();

    expect(devices()).toHaveLength(3);
    expect(screen.getByText("Firefox on Linux")).toBeTruthy();
    expect(screen.getByText("Safari on iOS")).toBeTruthy();
  });

  it("marks the current session and offers no revoke on it", async () => {
    await mount();

    const badge = screen.getByTestId("account-session-current");
    expect(badge.textContent).toBe("This device");
    expect(badge.closest("tr")?.textContent).toContain("Firefox on Linux");
    // Two row menus, for the two other sessions: the current row has none.
    expect(
      screen.getAllByRole("button", { name: "Open row actions" }),
    ).toHaveLength(2);
  });

  it("confirms a revoke, then removes the row", async () => {
    const links = await mount();

    const laptopRow = screen.getByText("Chrome on macOS").closest("tr")!;
    fireEvent.click(
      laptopRow.querySelector('[aria-label="Open row actions"]')!,
    );
    await clickMenuItem("Revoke");
    await confirmDialog("Revoke");

    await waitFor(() => expect(links.deleted).toEqual([LAPTOP]));
    await waitFor(() =>
      expect(screen.queryByText("Chrome on macOS")).toBeNull(),
    );
    expect(devices()).toHaveLength(2);
  });

  it("does nothing when the revoke is cancelled", async () => {
    const links = await mount();

    const laptopRow = screen.getByText("Chrome on macOS").closest("tr")!;
    fireEvent.click(
      laptopRow.querySelector('[aria-label="Open row actions"]')!,
    );
    await clickMenuItem("Revoke");
    await confirmDialog("Cancel");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(links.deleted).toEqual([]);
    expect(devices()).toHaveLength(3);
  });

  it("signs out every other session from the toolbar, keeping this one", async () => {
    const links = await mount();

    fireEvent.click(screen.getByRole("button", { name: "Sign out 2 others" }));
    await confirmDialog("Sign out everywhere else");

    await waitFor(() => expect(links.deletedOthers).toBe(1));
    await waitFor(() => expect(devices()).toHaveLength(1));
    expect(screen.getByText("Firefox on Linux")).toBeTruthy();
    // Nothing left to sign out, so the toolbar action goes.
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
  });
});
