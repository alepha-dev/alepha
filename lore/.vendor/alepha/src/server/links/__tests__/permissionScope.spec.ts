import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import {
  $issuer,
  $permission,
  $secure,
  AlephaSecurity,
  type UserAccountToken,
} from "alepha/security";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  type GetApiLinksOptions,
  ServerLinksProvider,
} from "../providers/ServerLinksProvider.ts";
import type { ApiRegistryResponse } from "../schemas/apiLinksResponseSchema.ts";

/**
 * Counts registry builds, so a test can tell a computed answer from a cached
 * one.
 */
class CountingServerLinksProvider extends ServerLinksProvider {
  public builds = 0;

  public override async getUserApiLinks(
    options: GetApiLinksOptions,
  ): Promise<ApiRegistryResponse> {
    this.builds++;
    return super.getUserApiLinks(options);
  }
}

class App {
  issuer = $issuer({
    secret: "secret-links-scope",
    roles: [
      {
        name: "editor",
        permissions: [
          { name: "docs:read" },
          { name: "docs:write" },
          { name: "docs:export" },
        ],
      },
    ],
  });

  // A virtual permission: reaches the registry's `permissions` list rather
  // than an action, through `getPermissions(user)`.
  export = $permission({ group: "docs", name: "export" });

  read = $action({
    use: [$secure({ permissions: ["docs:read"] })],
    schema: { response: z.text() },
    handler: () => "READ",
  });

  write = $action({
    use: [$secure({ permissions: ["docs:write"] })],
    schema: { response: z.text() },
    handler: () => "WRITTEN",
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(App)
    .with({ provide: ServerLinksProvider, use: CountingServerLinksProvider })
    .with(AlephaSecurity);
  const app = alepha.inject(App);
  await alepha.start();
  return { links: alepha.inject(CountingServerLinksProvider), app };
};

const editor = (permissionScope?: string[]): UserAccountToken => ({
  id: randomUUID(),
  realm: "issuer",
  roles: ["editor"],
  permissionScope,
});

describe("the link registry honours a permission scope", () => {
  it("tells a scoped identity about fewer actions than the same identity unscoped", async ({
    expect,
  }) => {
    const { links } = await boot();

    const unscoped = await links.getUserApiLinks({ user: editor() });
    const scoped = await links.getUserApiLinks({
      user: editor(["docs:read"]),
    });

    expect(unscoped.actions.read).toBeDefined();
    expect(unscoped.actions.write).toBeDefined();
    expect(scoped.actions.read).toBeDefined();
    expect(scoped.actions.write).toBeUndefined();
    expect(Object.keys(scoped.actions).length).toBeLessThan(
      Object.keys(unscoped.actions).length,
    );
  });

  it("narrows the virtual permission list through getPermissions(user)", async ({
    expect,
  }) => {
    const { links } = await boot();

    const unscoped = await links.getUserApiLinks({ user: editor() });
    const scoped = await links.getUserApiLinks({
      user: editor(["docs:read"]),
    });

    expect(unscoped.permissions).toContain("docs:export");
    expect(scoped.permissions ?? []).not.toContain("docs:export");
  });

  it("does not serve a scoped identity the unscoped identity's cached registry", async ({
    expect,
  }) => {
    const { links } = await boot();

    const unscoped = await links.getCachedUserApiLinks({ user: editor() });
    const scoped = await links.getCachedUserApiLinks({
      user: editor(["docs:read"]),
    });

    expect(links.builds).toBe(2);
    expect(unscoped.actions.write).toBeDefined();
    expect(scoped.actions.write).toBeUndefined();
  });

  it("keys an empty scope apart from an absent one", async ({ expect }) => {
    const { links } = await boot();

    await links.getCachedUserApiLinks({ user: editor() });
    const empty = await links.getCachedUserApiLinks({ user: editor([]) });

    expect(links.builds).toBe(2);
    expect(empty.actions.read).toBeUndefined();
  });

  it("shares one entry between two identities with the same scope in any order", async ({
    expect,
  }) => {
    const { links } = await boot();

    await links.getCachedUserApiLinks({
      user: editor(["docs:read", "docs:write"]),
    });
    await links.getCachedUserApiLinks({
      user: editor(["docs:write", "docs:read"]),
    });

    expect(links.builds).toBe(1);
  });
});
