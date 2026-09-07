import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { I18n } from "../../../services/I18n.ts";
import HeaderActions from "./HeaderActions.tsx";

/**
 * The Lore half of feedback #P2138: `@alepha/ui` owns the slot, this file
 * owns what goes in it. What is worth pinning here is the DECISION - the
 * avatar is passed only when the viewer has a picture - and the fallback,
 * which is the one path a picture can still take to the generic glyph.
 */
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
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    alepha.store.set("alepha.security.user", {
      id: "u-1",
      email: "ada@example.com",
      picture,
    } as never);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    return render(
      <AlephaContext.Provider value={alepha}>
        <HeaderActions />
      </AlephaContext.Provider>,
    );
  };

  const trigger = () => screen.getByLabelText("Account menu");

  it("keeps the plain glyph for a viewer with no picture", async () => {
    // ⚠️ Deliberate, not an omission. `UserAvatar` would draw its own glyph
    // inside a filled circle, which reads as a different KIND of control
    // beside three bare ghost icons - so a viewer who never set a picture
    // sees exactly what they saw before this shipped.
    await mount(undefined);

    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().querySelector("svg")).not.toBeNull();
  });

  it("serves the picture through the public file route", async () => {
    await mount("00000000-0000-4000-8000-00000000000a");

    const img = trigger().querySelector("img");
    // `public`, so it is the anonymous edge-cacheable route rather than the
    // authenticated one - this is chrome on every page.
    expect(img?.getAttribute("src")).toBe(
      "/api/public/files/00000000-0000-4000-8000-00000000000a",
    );
  });

  it("falls back to the glyph when the picture fails to load", async () => {
    // The deleted-or-forbidden case. Only the id is known up here, so
    // nothing before the browser can tell it will 404 - `FileImage`'s
    // `onError` is what has to catch it, and this is the surface where a
    // broken-image glyph would sit in the header of every page.
    await mount("00000000-0000-4000-8000-00000000000b");

    fireEvent.error(trigger().querySelector("img")!);

    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().querySelector("svg")).not.toBeNull();
  });
});
