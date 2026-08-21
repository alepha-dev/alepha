import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaReactRouter, ReactPageProvider } from "alepha/react/router";
import { afterEach, beforeEach, describe, it } from "vitest";

import { loreAdminOptions } from "../src/web/admin/adminChrome.tsx";
import { LoreWebAdmin } from "../src/web/admin/index.ts";

const SRC = join(import.meta.dirname, "../src");

/**
 * Nothing else in this repo asserts that `LoreWebAdmin` is actually what
 * mounts `/admin` in a running lore. `app-ssr-mode.spec.ts` proves the admin
 * *layout*'s rendering mode, but it does so by injecting `AdminRouter`
 * directly — which sidesteps `LoreWebAdmin` entirely and would stay green
 * even if `LoreWebAdmin.services` were emptied. `main.server.ts` /
 * `main.browser.ts` would then boot with no admin surface at all, `/admin`
 * would 404 in production, and every check in the repo — lint, typecheck,
 * this app's own test suite minus this file — would still be green.
 *
 * This spec closes that gap by booting a container with `LoreWebAdmin` (the
 * module, never `AdminRouter` directly) and asserting the route table it
 * produces, so deleting or emptying `LoreWebAdmin.services` is a red test
 * here instead of a silent production 404.
 */
describe("LoreWebAdmin wiring", () => {
  let alepha: Alepha;
  let pages: ReactPageProvider;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } });
    alepha.with(AlephaReactRouter);
    // Registering the module — not `alepha.inject(AdminRouter)` — is the
    // point: this is what proves `LoreWebAdmin` itself does the mounting.
    alepha.with(LoreWebAdmin);
    pages = alepha.inject(ReactPageProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("registers a page named 'admin' matching '/admin'", ({ expect }) => {
    const admin = pages.page("admin");
    expect(admin.match).toBe("/admin");
  });

  it("resolves '/admin/users'", ({ expect }) => {
    const users = pages.page("users");
    expect(users.match).toBe("/admin/users");
  });
});

/**
 * `main.server.ts` and `main.browser.ts` both need
 * `alepha.set(adminRouterOptionsAtom, loreAdminOptions)` — server-only would
 * leave the browser rendering the shared default chrome after hydration
 * (default "Admin" brand, un-hidden `firstName`/`lastName` columns), and
 * nothing else in this repo would notice: not typecheck, not lint, not this
 * app's own test suite, not e2e (which never asserts brand markup).
 *
 * Importing `main.server.ts` / `main.browser.ts` directly is impractical —
 * both call `run(alepha)` at module scope, which boots a real server. So
 * this asserts the two halves of the guard separately: `loreAdminOptions`
 * itself carries the right shape, and both entry files' source literally
 * wires it to the atom — so dropping the `alepha.set(...)` call from either
 * file fails this test even though the object it would have passed is fine.
 */
describe("lore's admin chrome", () => {
  it("loreAdminOptions carries lore's brand and hidden columns", ({
    expect,
  }) => {
    expect(loreAdminOptions.brand).toBeTruthy();
    expect(loreAdminOptions.pages?.users?.defaultHiddenColumns).toContain(
      "firstName",
    );
    expect(loreAdminOptions.pages?.users?.defaultHiddenColumns).toContain(
      "lastName",
    );
  });

  it("main.server.ts sets adminRouterOptionsAtom to loreAdminOptions", ({
    expect,
  }) => {
    const source = readFileSync(join(SRC, "main.server.ts"), "utf-8");
    expect(source).toMatch(
      /alepha\.set\(\s*adminRouterOptionsAtom\s*,\s*loreAdminOptions\s*\)/,
    );
  });

  it("main.browser.ts sets adminRouterOptionsAtom to loreAdminOptions", ({
    expect,
  }) => {
    const source = readFileSync(join(SRC, "main.browser.ts"), "utf-8");
    expect(source).toMatch(
      /alepha\.set\(\s*adminRouterOptionsAtom\s*,\s*loreAdminOptions\s*\)/,
    );
  });
});
