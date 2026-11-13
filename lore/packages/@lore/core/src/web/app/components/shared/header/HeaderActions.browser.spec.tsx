import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ShellExtensionRegistry } from "../../../registries/ShellExtensionRegistry.ts";
import { I18n } from "../../../services/I18n.ts";
import HeaderActions from "./HeaderActions.tsx";

/**
 * Feedback #P2138 in Lore's header. Since #Q2229 `ButtonUser` draws the
 * avatar itself and this header passes nothing, so what these pin is that
 * Lore's header still gets it: the viewer's initials without a picture
 * (#Q3577), the picture when there is one, and the initials when it fails to
 * load. The kit's own spec (`ButtonUserAvatar.browser.spec.tsx`) owns the
 * contract.
 */
/**
 * The realm's avatar endpoint, which `ButtonUser` reads to know the app uses
 * pictures.
 */
class Links extends LinkProvider {
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: () => Object.assign(async () => ({}), { can: () => true }),
    });
  }
}

describe("HeaderActions' account avatar", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (picture?: string) => {
    alepha = Alepha.create()
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    // What `LoreCoreWeb` registers for every page: the header renders the
    // app's entries from it.
    alepha.inject(ShellExtensionRegistry);
    alepha.store.set("alepha.security.user", {
      id: "u-1",
      email: "ada@example.com",
      picture,
    });
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    return render(
      <AlephaContext.Provider value={alepha}>
        <HeaderActions />
      </AlephaContext.Provider>,
    );
  };

  const trigger = () => screen.getByLabelText("Account menu");

  it("draws the viewer's initials when they have no picture", async () => {
    // The bare glyph it used to keep identified nobody (#Q3577).
    await mount(undefined);

    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().textContent).toBe("AD");
  });

  it("serves the picture through the authenticated file route", async () => {
    await mount("00000000-0000-4000-8000-00000000000a");

    const img = trigger().querySelector("img");
    // The kit default, and no longer the public route: the viewer's own
    // avatar is `private, max-age=1y` in the browser, so an edge cache
    // would only share it with viewers who never ask for it.
    expect(img?.getAttribute("src")).toBe(
      "/api/files/00000000-0000-4000-8000-00000000000a",
    );
  });

  it("falls back to the initials when the picture fails to load", async () => {
    // The deleted-or-forbidden case. Only the id is known up here, so
    // nothing before the browser can tell it will 404 - `FileImage`'s
    // `onError` is what has to catch it, and this is the surface where a
    // broken-image glyph would sit in the header of every page.
    await mount("00000000-0000-4000-8000-00000000000b");

    fireEvent.error(trigger().querySelector("img")!);

    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().textContent).toBe("AD");
  });
});
