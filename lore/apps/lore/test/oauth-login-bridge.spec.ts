import { Alepha } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppRouter } from "../src/web/app/AppRouter.ts";

/**
 * The login page's bridge back into the server-rendered OAuth pages, #Q2217.
 *
 * `alepha/api/oauth` sends a signed-out visitor to `/auth/login?redirect_uri=`,
 * and `AuthLogin` only ever reads `?redirect`, so the login loader has to
 * translate one into the other. It never did: a loader's `query` holds only
 * what the page's schema declares, the login page declared none, and so
 * `query.redirect_uri` was always undefined. Everyone who signed in on the way
 * to a consent screen or a device approval landed on the home page instead.
 *
 * Rendered through the router rather than by calling the loader, because the
 * schema decode in between is exactly where the value went missing.
 */
describe("the login page's OAuth bridge", () => {
  let alepha: Alepha;
  let pages: AppRouter;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    // i18n only so a page that does NOT redirect renders instead of throwing:
    // without it a missing bridge fails on the layout, not on the assertion.
    alepha.with(AlephaReactRouter).with(AlephaReactI18n);
    pages = alepha.inject(AppRouter);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const bridged = (to: string) =>
    `/auth/login?redirect=${encodeURIComponent(
      `/oauth/continue?to=${encodeURIComponent(to)}`,
    )}`;

  it("sends a device approval back to the device page after sign-in", async ({
    expect,
  }) => {
    const to = "/oauth/device?user_code=CDFG-HJKM";

    const rendered = await pages.login.render({
      query: { redirect_uri: to },
    });

    expect(rendered.redirect).toBe(bridged(to));
  });

  it("sends a consent request back to the authorize endpoint", async ({
    expect,
  }) => {
    const to = "/oauth/authorize?response_type=code&client_id=mcp_x";

    const rendered = await pages.login.render({
      query: { redirect_uri: to },
    });

    expect(rendered.redirect).toBe(bridged(to));
  });
});
