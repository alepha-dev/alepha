import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { MyProfile, RealmConfig } from "alepha/api/users";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi, uiAtom } from "alepha/react/ui";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks, expectAccessible } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
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
 * Every `updateMyProfile` body sent, in order.
 */
const updates: unknown[] = [];

/**
 * Every verify-my-address call, in order (#Q4096).
 */
const verifications: string[] = [];

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
          const action: any = async (request?: unknown) => {
            if (name === "getMyProfile") return profile;
            if (name === "getRealmConfig") return realm;
            if (name === "requestMyEmailVerification") {
              verifications.push("request");
              return { ok: true };
            }
            if (name === "verifyMyEmail") {
              const body = (request as { body: { code: string } }).body;
              verifications.push(`verify:${body.code}`);
              return { ...profile, emailVerified: true };
            }
            if (name === "updateMyProfile") {
              const body = (request as { body: Record<string, unknown> }).body;
              updates.push(body);
              return { ...profile, ...body };
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
 * The username row follows the realm's `settings.username`: hidden only
 * where the realm has none (`"none"`). In an `"email"` realm the handle
 * derived from the address is a default the person may rename.
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
    updates.length = 0;
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AccountProfile />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("First name");
  };

  it.each(["optional", "required", "email"])(
    "shows the username in a %s realm",
    async (mode) => {
      await mount(mode);
      expect(screen.queryByText("Username")).not.toBeNull();
    },
  );

  /**
   * A username change has consequences a name change does not (#Q3938):
   * the save asks first, saying what changes, and Cancel sends nothing.
   */
  describe("changing the username", () => {
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

    it("asks first, sends nothing on cancel, and saves on confirm", async () => {
      await mount("optional");
      type("Username", "janet");
      save();

      const confirm = await screen.findByRole("alertdialog");
      expect(confirm.textContent).toContain("Change your username to janet?");
      expect(confirm.textContent).toContain(
        "Anything written with @jane, such as mentions and links, keeps saying @jane and stops reaching you.",
      );
      expect(confirm.textContent).toContain("someone else can take it");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Keep jane" }));
      });
      expect(updates).toEqual([]);

      save();
      await screen.findByRole("alertdialog");
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Change username" }),
        );
      });
      await vi.waitFor(() =>
        expect(updates).toEqual([
          { username: "janet", firstName: "Jane", lastName: "Doe" },
        ]),
      );
    });

    it("saves a name change without asking", async () => {
      await mount("optional");
      type("First name", "Janine");
      save();

      await vi.waitFor(() =>
        expect(updates).toEqual([
          { username: "jane", firstName: "Janine", lastName: "Doe" },
        ]),
      );
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  /**
   * Verify my address (#Q4096): offered while the address is unverified, a
   * code sent and typed back here, and gone once it is verified.
   */
  it("verifies an unverified address with the code sent to it", async () => {
    verifications.length = 0;
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Verify my address" }),
      );
    });
    fireEvent.change(await screen.findByLabelText("Code"), {
      target: { value: "123456" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    });

    await vi.waitFor(() =>
      expect(verifications).toEqual(["request", "verify:123456"]),
    );
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Verify my address" }),
      ).toBeNull(),
    );
  });

  it("hides the username in a none realm", async () => {
    await mount("none");
    expect(screen.queryByText("Username")).toBeNull();
  });

  it("shows the username when no realm is described", async () => {
    await mount();
    expect(screen.queryByText("Username")).not.toBeNull();
    // axe: the profile page (#Q3338).
    await expectAccessible();
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
