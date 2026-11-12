import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { MyProfile, RealmConfig } from "alepha/api/users";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi, uiAtom } from "alepha/react/ui";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import AccountProfile from "../AccountProfile.tsx";

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "jane@example.test",
  username: "jane",
  firstName: "Jane",
  lastName: "Doe",
  roles: ["user"],
} as unknown as MyProfile;

/**
 * What `getRealmConfig` answers, set by each test's `mount`.
 */
let realm: RealmConfig | undefined;

/**
 * Every action exists: the section fetches the profile and the realm, and
 * every other call answers nothing.
 */
class Links extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async () => {
            if (name === "getMyProfile") return profile;
            if (name === "getRealmConfig") return realm;
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
 * The username row follows the realm's `settings.username`: shown where a
 * person chooses one, hidden where the realm has none (`"none"`) or derives
 * it from the address (`"email"`), the same rule as the registration form.
 */
describe("AccountProfile", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (username?: string) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactUi)
      .with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    realm = (username ? { settings: { username } } : undefined) as
      | RealmConfig
      | undefined;
    render(
      <AlephaContext.Provider value={alepha}>
        <AccountProfile />
      </AlephaContext.Provider>,
    );
    await screen.findByText("First name");
  };

  it.each(["optional", "required"])(
    "shows the username in a %s realm",
    async (mode) => {
      await mount(mode);
      expect(screen.queryByText("Username")).not.toBeNull();
    },
  );

  it.each(["none", "email"])(
    "hides the username in a %s realm",
    async (mode) => {
      await mount(mode);
      expect(screen.queryByText("Username")).toBeNull();
    },
  );

  it("shows the username when no realm is described", async () => {
    await mount();
    expect(screen.queryByText("Username")).not.toBeNull();
  });

  /**
   * Colour-blind mode is set here, not in the account menu: one switch bound
   * to the vision preference, both ways.
   */
  it("holds the colour-blind switch, bound to the vision preference", async () => {
    await mount();

    expect(screen.getByText("Display")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Colour-blind mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => fireEvent.click(toggle));
    expect(alepha!.store.get(uiAtom).vision).toBe("cvd");
    expect(
      screen
        .getByRole("switch", { name: "Colour-blind mode" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    await act(async () =>
      fireEvent.click(
        screen.getByRole("switch", { name: "Colour-blind mode" }),
      ),
    );
    expect(alepha!.store.get(uiAtom).vision).toBe("normal");
  });

  it("shows the switch on when the preference already is", async () => {
    await mount();
    await act(async () =>
      alepha!.store.set(uiAtom, {
        ...alepha!.store.get(uiAtom),
        vision: "cvd",
      }),
    );

    expect(
      screen
        .getByRole("switch", { name: "Colour-blind mode" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
