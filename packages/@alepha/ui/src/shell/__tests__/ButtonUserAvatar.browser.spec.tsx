import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ButtonUser } from "../button-user.tsx";

/**
 * The account button's avatar (feedback #P2138, #Q2229).
 *
 * The button draws the viewer's own picture by default, from
 * `useAuth().user.picture`, and `avatar` overrides it. It used to be a slot
 * only, on the premise that turning a file id into a URL was the consuming
 * application's routing; both routes belong to `alepha/api/files`, so every
 * shell but Lore's showed the glyph for no reason. What these pin: which
 * route, the bare glyph without a picture, the fallback on a failed load,
 * and that the slot still wins.
 */
describe("ButtonUser's avatar", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: {
    avatar?: ReactNode;
    signedIn?: boolean;
    picture?: string;
  }) => {
    alepha = Alepha.create().with(AlephaReactRouter);
    if (options.signedIn !== false) {
      alepha.store.set("alepha.security.user", {
        id: "u-1",
        email: "ada@example.com",
        picture: options.picture,
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

  it("draws the generic glyph for a viewer with no picture", async () => {
    await mount({});

    expect(trigger().querySelector("svg")).not.toBeNull();
    expect(trigger().querySelector("img")).toBeNull();
    // The BARE glyph, not `UserAvatar`'s glyph-in-a-circle: beside the
    // ghost icons of `AppActions`, a filled circle reads as another kind of
    // control.
    expect(trigger().querySelector(".rounded-full")).toBeNull();
  });

  it("draws the viewer's picture through the authenticated file route", async () => {
    await mount({ picture: "00000000-0000-4000-8000-00000000000a" });

    const img = trigger().querySelector("img");
    // Authenticated, not public: the default `FileAccessProvider` serves the
    // uploader there with no opt-in, and refuses every public read.
    expect(img?.getAttribute("src")).toBe(
      "/api/files/00000000-0000-4000-8000-00000000000a",
    );
    // `size-7` inside the `size-9` button, where the glyph was `size-4`.
    expect(trigger().querySelector(".size-7")).not.toBeNull();
  });

  it("falls back when the picture fails to load", async () => {
    await mount({ picture: "00000000-0000-4000-8000-00000000000b" });

    fireEvent.error(trigger().querySelector("img")!);

    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().querySelector("svg")).not.toBeNull();
  });

  it("draws the slot INSTEAD of the glyph when one is passed", async () => {
    await mount({ avatar: <span data-testid="avatar">face</span> });

    expect(trigger().querySelector('[data-testid="avatar"]')).not.toBeNull();
    // ⚠️ Instead, not beside: the button is `size="icon"`, so a glyph left
    // next to an avatar would not be a fallback, it would be two things in
    // one 36px control.
    expect(trigger().querySelector("svg")).toBeNull();
  });

  it("lets the slot win over the viewer's picture", async () => {
    await mount({
      avatar: <span data-testid="avatar">face</span>,
      picture: "00000000-0000-4000-8000-00000000000c",
    });

    expect(trigger().querySelector('[data-testid="avatar"]')).not.toBeNull();
    expect(trigger().querySelector("img")).toBeNull();
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
