import { Alepha, type AppSurface, ContainerLockedError } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { $secure, AlephaSecurity, SecurityProvider } from "../index.ts";

/**
 * A pure controller is created on its first request, after start, while its
 * `$secure({ permissions })` used to register those permissions when it was
 * constructed (#Q3416). The build list carries them, the registry is filled
 * from it at boot, and the late `$secure` finds them there.
 */
class QuestApi {
  list = $action({
    method: "GET",
    path: "/quests",
    use: [$secure({ permissions: ["quest:read"] })],
    handler: () => "ok",
  });
}

const surface: AppSurface = {
  version: 1,
  classes: [{ key: "QuestApi", pure: true, permissions: ["quest:read"] }],
  actions: [],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

const boot = async () => {
  const alepha = Alepha.create()
    .useSurface(surface)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(QuestApi);
  await alepha.start();
  return alepha;
};

describe("permissions of a pure controller", () => {
  it("are registered at boot, with no controller created", async ({
    expect,
  }) => {
    const alepha = await boot();
    expect(alepha.has(QuestApi)).toBe(false);
    expect(
      alepha
        .inject(SecurityProvider)
        .getPermissions()
        .some((it) => `${it.group}:${it.name}` === "quest:read"),
    ).toBe(true);
    await alepha.stop();
  });

  it("validate a role naming one, created after start", async ({ expect }) => {
    const alepha = await boot();
    const security = alepha.inject(SecurityProvider);
    expect(() =>
      security.createRole({
        name: "reader",
        permissions: [{ name: "quest:read" }],
      }),
    ).not.toThrow();
    await alepha.stop();
  });

  it("let the first hit create the controller, and still refuse an unknown permission", async ({
    expect,
  }) => {
    const alepha = await boot();
    expect(() => alepha.inject(QuestApi)).not.toThrow();
    expect(() =>
      alepha.inject(SecurityProvider).createPermission("nobody:declared"),
    ).toThrow(ContainerLockedError);
    await alepha.stop();
  });
});
