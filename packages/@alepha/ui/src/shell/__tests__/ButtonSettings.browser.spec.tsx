import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { AlephaReactUi } from "alepha/react/ui";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ButtonSettings,
  type ButtonSettingsProps,
} from "../ButtonSettings.tsx";

/**
 * Where the settings go. Signed out there is no menu, so they are buttons;
 * signed in they move into the account menu unless `placement="buttons"`
 * keeps them out.
 *
 * Only display mode is asserted as a control: language and theme hide
 * themselves at one registered option, and this container registers one of
 * each.
 */
describe("ButtonSettings", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: {
    signedIn: boolean;
    props?: ButtonSettingsProps;
  }) => {
    alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(AlephaReactUi);
    if (options.signedIn) {
      alepha.store.set("alepha.security.user", {
        id: "u-1",
        email: "ada@example.com",
      } as never);
    }
    await alepha.start();

    return render(
      <AlephaContext.Provider value={alepha}>
        <ButtonSettings {...options.props} />
      </AlephaContext.Provider>,
    );
  };

  const openMenu = () => {
    fireEvent.click(screen.getByLabelText("Account menu"));
  };

  it("draws the settings as buttons beside sign-in when signed out", async () => {
    await mount({ signedIn: false });

    expect(screen.getByLabelText("Toggle color mode")).toBeTruthy();
    expect(screen.getByLabelText("Sign in")).toBeTruthy();
  });

  it("draws one button and moves the settings into its menu when signed in", async () => {
    await mount({ signedIn: true });

    expect(screen.queryByLabelText("Toggle color mode")).toBeNull();

    openMenu();

    expect(
      await screen.findByRole("menuitem", { name: "Display Mode" }),
    ).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Logout" })).toBeTruthy();
  });

  it("keeps the settings as buttons when placement is 'buttons'", async () => {
    await mount({ signedIn: true, props: { placement: "buttons" } });

    expect(screen.getByLabelText("Toggle color mode")).toBeTruthy();

    openMenu();

    expect(
      await screen.findByRole("menuitem", { name: "Logout" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Display Mode" })).toBeNull();
  });

  it("names the display-mode submenu and its options from labels", async () => {
    await mount({
      signedIn: true,
      props: {
        labels: {
          colorMode: "Mode d'affichage",
          colorModeSystem: "Système",
          colorModeDark: "Sombre",
          colorModeLight: "Clair",
        },
      },
    });

    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Mode d'affichage" }),
    );

    expect(
      await screen.findByRole("menuitemradio", { name: "Système" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Sombre" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Clair" })).toBeTruthy();
  });
});
