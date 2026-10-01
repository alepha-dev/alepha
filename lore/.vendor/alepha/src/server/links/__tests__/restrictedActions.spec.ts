import { Alepha } from "alepha";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { describe, it } from "vitest";

import { LinkProvider, ServerLinksProvider } from "../index.ts";

/**
 * An action the caller may not invoke is pruned from the registry, which
 * used to make it indistinguishable from an action that was never
 * registered: both surfaced as `401 "Action <name> not found."`.
 *
 * That is wrong for a signed-in user — it is a refusal, not a missing
 * route — and consumers had no way to tell the two apart short of
 * matching on the message text. Apps that redirect 401 to a login page
 * would bounce an authenticated user out of the app for what should have
 * been an "access denied" screen.
 *
 * The registry now carries a `restricted` list for authenticated callers,
 * and the client answers 403 for those names.
 */
describe("restricted actions", () => {
  class App {
    openAction = $action({
      use: [$secure()],
      handler: () => "OPEN",
    });

    adminAction = $action({
      use: [$secure({ roles: ["admin"] })],
      handler: () => "ADMIN",
    });
  }

  const boot = async () => {
    const alepha = Alepha.create()
      .with(App)
      .with(AlephaSecurity)
      .with(ServerLinksProvider);
    await alepha.start();
    return alepha;
  };

  const registryFor = async (
    alepha: Alepha,
    user?: { id: string; roles: string[] },
  ) =>
    await alepha
      .inject(ServerLinksProvider)
      .getUserApiLinks({ user } as Parameters<
        ServerLinksProvider["getUserApiLinks"]
      >[0]);

  it("lists an action the user may not call under `restricted`", async ({
    expect,
  }) => {
    const alepha = await boot();
    const registry = await registryFor(alepha, {
      id: "u1",
      roles: [],
    });

    expect(Object.keys(registry.actions)).toContain("openAction");
    expect(Object.keys(registry.actions)).not.toContain("adminAction");
    expect(registry.restricted).toContain("adminAction");

    await alepha.stop();
  });

  it("omits `restricted` entirely for an admin who may call everything", async ({
    expect,
  }) => {
    const alepha = await boot();
    const registry = await registryFor(alepha, {
      id: "u2",
      roles: ["admin"],
    });

    expect(Object.keys(registry.actions)).toContain("adminAction");
    expect(registry.restricted).toBeUndefined();

    await alepha.stop();
  });

  // An anonymous caller is missing *every* action, so listing them would
  // leak the whole registry to unauthenticated clients for no benefit:
  // their 401 is already the correct answer, and it is what drives the
  // redirect to a login page.
  it("does not disclose restricted names to an anonymous caller", async ({
    expect,
  }) => {
    const alepha = await boot();
    const registry = await registryFor(alepha, undefined);

    expect(registry.restricted).toBeUndefined();

    await alepha.stop();
  });

  it("answers 403 — not 401 — when following a restricted action", async ({
    expect,
  }) => {
    const alepha = await boot();
    const linkProvider = alepha.inject(LinkProvider);

    alepha.store.set(
      "alepha.server.request.apiLinks",
      await registryFor(alepha, { id: "u3", roles: [] }),
    );

    const error = await linkProvider.follow("adminAction", {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(HttpError.is(error, 403)).toBe(true);

    await alepha.stop();
  });

  it("still answers 401 for an action that does not exist at all", async ({
    expect,
  }) => {
    const alepha = await boot();
    const linkProvider = alepha.inject(LinkProvider);

    alepha.store.set(
      "alepha.server.request.apiLinks",
      await registryFor(alepha, { id: "u4", roles: [] }),
    );

    const error = await linkProvider.follow("noSuchAction", {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(HttpError.is(error, 401)).toBe(true);

    await alepha.stop();
  });
});
