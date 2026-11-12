import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DropdownMenu, DropdownMenuContent } from "../../core/DropdownMenu.tsx";
import { $settingsDialog } from "../../settings/$settingsDialog.ts";
import { $settingsSection } from "../../settings/$settingsSection.ts";
import { settingsDialogsAtom } from "../../settings/SettingsDialogs.ts";
import { ButtonUser } from "../ButtonUser.tsx";

let offered = true;

class AccountLike {
  dialog = $settingsDialog({ name: "account", title: "Account" });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    can: () => offered,
    lazy: () => Promise.resolve({ default: () => null }),
  });
}

/**
 * The account item of the user menu opens the account dialog, and hides
 * itself when there is nothing to open: no account dialog at all, or one
 * whose every section is hidden. A visible item opening nothing would be the
 * old failure, a menu entry leading nowhere.
 */
describe("ButtonUser.AccountMenuItem", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    offered = true;
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: { withAccountDialog: boolean }) => {
    alepha = Alepha.create().with(AlephaReactRouter);
    if (options.withAccountDialog) {
      alepha.with(AccountLike);
    }

    // A signed-in viewer; the item is account-holder-only.
    alepha.store.set("alepha.security.user", {
      id: "u-1",
      email: "ada@example.com",
    });
    await alepha.start();

    // `DropdownMenuItem` needs a menu ancestor (Base UI throws without one),
    // and the menu must be open for its content to mount.
    return render(
      <AlephaContext.Provider value={alepha}>
        <DropdownMenu open>
          <DropdownMenuContent>
            <ButtonUser.AccountMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </AlephaContext.Provider>,
    );
  };

  it("renders nothing when no account dialog is declared", async () => {
    await mount({ withAccountDialog: false });

    expect(screen.queryByText("User Account")).toBeNull();
  });

  it("renders nothing when the dialog has no visible section", async () => {
    offered = false;
    await mount({ withAccountDialog: true });

    expect(screen.queryByText("User Account")).toBeNull();
  });

  it("opens the account dialog, as a menu item and not a link", async () => {
    await mount({ withAccountDialog: true });

    const item = screen.getByText("User Account").closest("[role=menuitem]")!;
    expect(item.tagName).not.toBe("A");
    act(() => {
      fireEvent.click(item);
    });

    expect(alepha!.store.get(settingsDialogsAtom)).toMatchObject({
      open: "account",
      section: "profile",
    });
  });
});
