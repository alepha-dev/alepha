import { Alepha } from "alepha";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import {
  type GetApiLinksOptions,
  ServerLinksProvider,
} from "../providers/ServerLinksProvider.ts";
import type { ApiRegistryResponse } from "../schemas/apiLinksResponseSchema.ts";

/**
 * Counts how many times the registry is actually built, which is the whole
 * question: the response is byte-identical for every caller with the same
 * identity, and building it is ~300 permission checks plus a round trip to
 * every proxy remote.
 */
class CountingServerLinksProvider extends ServerLinksProvider {
  public builds = 0;

  public override async getUserApiLinks(
    options: GetApiLinksOptions,
  ): Promise<ApiRegistryResponse> {
    this.builds++;
    return super.getUserApiLinks(options);
  }

  public get cacheSize(): number {
    return this.registryCache.size;
  }
}

class App {
  hello = $action({
    handler: () => "hello",
  });
}

const start = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(App)
    .with({ provide: ServerLinksProvider, use: CountingServerLinksProvider });
  await alepha.start();
  return alepha.inject(CountingServerLinksProvider);
};

describe("ServerLinksProvider registry cache", () => {
  it("should build the registry once for two callers of the same identity", async ({
    expect,
  }) => {
    const links = await start();

    const first = await links.getCachedUserApiLinks({});
    const second = await links.getCachedUserApiLinks({});

    expect(links.builds).toBe(1);
    expect(second).toEqual(first);
  });

  it("should keep one entry per identity", async ({ expect }) => {
    const links = await start();

    await links.getCachedUserApiLinks({});
    await links.getCachedUserApiLinks({
      user: { sub: "a", realm: "main", roles: ["admin"] } as any,
    });
    await links.getCachedUserApiLinks({
      user: { sub: "b", realm: "main", roles: ["admin"] } as any,
    });

    // Anonymous, and one for the shared realm + role set: the two admins are
    // the same identity as far as the registry is concerned.
    expect(links.builds).toBe(2);
    expect(links.cacheSize).toBe(2);
  });

  it("should bound the cache instead of growing with every role combination", async ({
    expect,
  }) => {
    const links = await start();

    for (let i = 0; i < 300; i++) {
      await links.getCachedUserApiLinks({
        user: { sub: "u", realm: "main", roles: [`role-${i}`] } as any,
      });
    }

    expect(links.builds).toBe(300);
    expect(links.cacheSize).toBeLessThanOrEqual(128);
  });

  it("should keep the identity it just served when evicting", async ({
    expect,
  }) => {
    const links = await start();

    await links.getCachedUserApiLinks({});
    for (let i = 0; i < 200; i++) {
      await links.getCachedUserApiLinks({
        user: { sub: "u", realm: "main", roles: [`role-${i}`] } as any,
      });
      // Anonymous is the hottest identity there is: keep asking for it.
      await links.getCachedUserApiLinks({});
    }

    // 200 role sets, plus anonymous once.
    expect(links.builds).toBe(201);
  });
});
