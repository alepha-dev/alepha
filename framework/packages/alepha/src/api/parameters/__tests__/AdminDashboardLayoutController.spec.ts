import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { $role, AlephaSecurity, type UserAccountToken } from "alepha/security";
import { ConflictError, ForbiddenError } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AdminDashboardLayoutController,
  AlephaApiParameters,
  ParameterProvider,
} from "../index.ts";

class Roles {
  /**
   * May open `/admin`, and nothing about parameters.
   */
  viewer = $role({
    name: "dashboard-viewer",
    permissions: [{ name: "admin:ui" }],
  });

  editor = $role({
    name: "dashboard-editor",
    permissions: [{ name: "admin:ui" }, { name: "admin:parameter:create" }],
  });
}

const user = (role: string, username: string): UserAccountToken => ({
  id: "00000000-0000-4000-8000-00000000abcd",
  realm: "default",
  roles: [role],
  username,
});

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaSecurity)
    .with(AlephaApiParameters);
  alepha.inject(Roles);
  await alepha.start();
  return {
    controller: alepha.inject(AdminDashboardLayoutController),
    provider: alepha.inject(ParameterProvider),
  };
};

const LAYOUT = {
  tiles: [
    { id: "failed-sign-ins", enabled: true },
    { id: "users", enabled: false },
  ],
};

/**
 * The admin dashboard layout's server home (#Q3545): one `$parameter`, read
 * by any admin, written with a version check on the unique index.
 */
describe("AdminDashboardLayoutController", () => {
  it("reads the empty default, version 0, without any parameter permission", async () => {
    const { controller } = await boot();
    const read = await controller.getAdminDashboardLayout.run(
      {},
      { user: user("dashboard-viewer", "viewer") },
    );
    expect(read).toEqual({ layout: { tiles: [] }, version: 0 });
  });

  it("refuses a write without admin:parameter:create", async () => {
    const { controller } = await boot();
    await expect(
      controller.setAdminDashboardLayout.run(
        { body: { layout: LAYOUT, expectedVersion: 0 } },
        { user: user("dashboard-viewer", "viewer") },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("saves with the version it read, and a viewer reads it back", async () => {
    const { controller } = await boot();
    const saved = await controller.setAdminDashboardLayout.run(
      { body: { layout: LAYOUT, expectedVersion: 0 } },
      { user: user("dashboard-editor", "alice") },
    );
    expect(saved).toEqual({ layout: LAYOUT, version: 1 });

    const read = await controller.getAdminDashboardLayout.run(
      {},
      { user: user("dashboard-viewer", "viewer") },
    );
    expect(read).toEqual({ layout: LAYOUT, version: 1 });
  });

  it("answers 409 to a save from a stale version, and keeps the other admin's layout", async () => {
    const { controller } = await boot();
    const first = await controller.setAdminDashboardLayout.run(
      { body: { layout: LAYOUT, expectedVersion: 0 } },
      { user: user("dashboard-editor", "alice") },
    );
    expect(first.version).toBe(1);

    // Bob loaded version 0 too, before Alice saved.
    await expect(
      controller.setAdminDashboardLayout.run(
        { body: { layout: { tiles: [] }, expectedVersion: 0 } },
        { user: user("dashboard-editor", "bob") },
      ),
    ).rejects.toThrow(ConflictError);
    // A version nobody has read is refused the same way.
    await expect(
      controller.setAdminDashboardLayout.run(
        { body: { layout: { tiles: [] }, expectedVersion: 7 } },
        { user: user("dashboard-editor", "bob") },
      ),
    ).rejects.toThrow(ConflictError);

    const read = await controller.getAdminDashboardLayout.run(
      {},
      { user: user("dashboard-viewer", "viewer") },
    );
    expect(read).toEqual({ layout: LAYOUT, version: 1 });
  });

  it("lets exactly one of two concurrent saves from one version through", async () => {
    const { controller } = await boot();
    const results = await Promise.allSettled([
      controller.setAdminDashboardLayout.run(
        { body: { layout: LAYOUT, expectedVersion: 0 } },
        { user: user("dashboard-editor", "alice") },
      ),
      controller.setAdminDashboardLayout.run(
        { body: { layout: { tiles: [] }, expectedVersion: 0 } },
        { user: user("dashboard-editor", "bob") },
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError,
    );
  });

  it("writes a history row with its author, like any parameter", async () => {
    const { controller, provider } = await boot();
    await controller.setAdminDashboardLayout.run(
      { body: { layout: LAYOUT, expectedVersion: 0 } },
      { user: user("dashboard-editor", "alice") },
    );
    await controller.setAdminDashboardLayout.run(
      { body: { layout: { tiles: [] }, expectedVersion: 1 } },
      { user: user("dashboard-editor", "bob") },
    );

    const history = await provider.getHistory("admin.dashboard.layout");
    expect(history.map((row) => [row.version, row.creatorName])).toEqual([
      [2, "bob"],
      [1, "alice"],
    ]);
  });
});
