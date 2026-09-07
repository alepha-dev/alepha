import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ButtonUser } from "../button-user.tsx";

/**
 * The avatar slot (feedback #P2138).
 *
 * ⚠️ What these pin is that the package stays UNABLE to draw an avatar
 * itself. `useAuth().user` carries `picture`, and it is tempting to read it
 * here - but it is a file id, and the route serving it belongs to the
 * consuming application. So the contract is a node in, the glyph when
 * nothing is passed, and nothing about file routing anywhere in this file.
 */
describe("ButtonUser's avatar slot", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: { avatar?: ReactNode; signedIn?: boolean }) => {
    alepha = Alepha.create().with(AlephaReactRouter);
    if (options.signedIn !== false) {
      alepha.store.set("alepha.security.user", {
        id: "u-1",
        email: "ada@example.com",
      } as never);
    }
    await alepha.start();

    return render(
      <AlephaContext.Provider value={alepha}>
        <ButtonUser avatar={options.avatar} onSignIn={() => {}} />
      </AlephaContext.Provider>,
    );
  };

  const trigger = () => screen.getByLabelText("Account menu");

  it("draws the generic glyph when nothing is passed", async () => {
    await mount({});

    expect(trigger().querySelector("svg")).not.toBeNull();
    expect(trigger().querySelector('[data-testid="avatar"]')).toBeNull();
  });

  it("draws the slot INSTEAD of the glyph when one is passed", async () => {
    await mount({ avatar: <span data-testid="avatar">face</span> });

    expect(trigger().querySelector('[data-testid="avatar"]')).not.toBeNull();
    // ⚠️ Instead, not beside: the button is `size="icon"`, so a glyph left
    // next to an avatar would not be a fallback, it would be two things in
    // one 36px control.
    expect(trigger().querySelector("svg")).toBeNull();
  });

  it("keeps the accessible name, which the avatar is not", async () => {
    await mount({ avatar: <span data-testid="avatar">face</span> });

    // A face names nobody to a screen reader, and the tooltip says the same
    // word the label does.
    expect(trigger().getAttribute("aria-label")).toBe("Account menu");
  });

  it("never reaches the slot when signed out", async () => {
    // That branch returns before the menu is built, so a consumer passing an
    // avatar unconditionally still gets the sign-in button.
    await mount({
      avatar: <span data-testid="avatar">face</span>,
      signedIn: false,
    });

    expect(screen.queryByLabelText("Account menu")).toBeNull();
    expect(screen.getByLabelText("Sign in")).toBeTruthy();
    expect(screen.queryByTestId("avatar")).toBeNull();
  });
});
