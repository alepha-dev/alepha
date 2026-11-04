import type { Alepha } from "alepha";
import { BadRequestError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AppService,
  BackupController,
  EstateEventService,
  EstateInventoryService,
} from "../src/api/index.ts";
import {
  bootStackSpec,
  createInstance,
  lentBayEstate,
  type StackWorld,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * The project-side door to a copy's backups (the app's Backups tab). The
 * machine knows the copy by `<project>-<app>` (its resource name minus the
 * environment), so every route resolves that name from the copy itself and
 * never takes one from the caller: a member of one project must not reach
 * another app's restore points through a shared estate.
 */
describe("BackupController", () => {
  let alepha: Alepha;
  let api: BackupController;

  beforeEach(async () => {
    alepha = await bootStackSpec();
    api = alepha.inject(BackupController);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const params = (w: StackWorld, app = "minpricing") => ({
    projectId: w.project.id,
    app,
    env: "production",
  });

  /** A copy pointed at a lent Bay estate and deployed there once. */
  const deployed = async (app = "minpricing", w?: StackWorld) => {
    const world = w ?? (await stackWorld(alepha));
    const estate = await lentBayEstate(world);
    const instance = await createInstance(alepha, world, app, "production");
    const machineApp = `p${world.project.id}-${app}`;
    await world.rows.instances.updateById(instance.id, {
      estateId: estate.id,
      resourceName: `${machineApp}-production`,
      resourceEstateId: estate.id,
    });
    return { w: world, estate, instance, machineApp };
  };

  it("says why there is nothing to show, step by step", async ({ expect }) => {
    const w = await stackWorld(alepha);
    const instance = await createInstance(
      alepha,
      w,
      "minpricing",
      "production",
    );
    const view = () =>
      api.getAppBackup({ params: params(w), query: {} }, { user: w.user });

    expect((await view()).status).toBe("no-estate");

    const estate = await lentBayEstate(w);
    await w.rows.instances.updateById(instance.id, { estateId: estate.id });
    expect((await view()).status).toBe("not-deployed");

    await w.rows.instances.updateById(instance.id, {
      resourceName: "acme-minpricing-production",
      resourceEstateId: estate.id,
    });
    const unreported = await view();
    expect(unreported.status).toBe("not-reported");
    expect(unreported.machineApp).toBe("acme-minpricing");

    await w.rows.grants.deleteMany({ estateId: { eq: estate.id } });
    expect((await view()).status).toBe("not-lent");
  });

  it("shows the reported block and only this copy's events, with the estate-wide ones", async ({
    expect,
  }) => {
    const { w, estate, machineApp } = await deployed();
    await alepha.inject(EstateInventoryService).record(estate, {
      type: "inventory",
      at: new Date().toISOString(),
      host: { bayVersion: "0.40.0" },
      apps: [
        {
          app: machineApp,
          env: "production",
          runtime: "node",
          running: true,
          backups: true,
          problems: [],
          backup: { state: "ok" },
        },
      ],
    } as never);
    const events = alepha.inject(EstateEventService);
    const at = new Date().toISOString();
    for (const [id, app] of [
      ["mine", machineApp],
      ["theirs", "other-app"],
      ["estate", undefined],
    ] as const) {
      await events.record(estate, {
        type: "event",
        id,
        kind: "backup.completed",
        at,
        ...(app ? { app, env: "production" } : {}),
      });
    }

    const view = await api.getAppBackup(
      { params: params(w), query: {} },
      { user: w.user },
    );
    expect(view.status).toBe("reported");
    expect(view.instance?.backup?.state).toBe("ok");
    expect(view.events.map((e) => e.eventId).sort()).toEqual([
      "estate",
      "mine",
    ]);
  });

  it("queues a command under the machine's name, never one the caller gives", async ({
    expect,
  }) => {
    const { w, machineApp } = await deployed();
    const command = await api.sendAppBackupCommand(
      {
        params: params(w),
        body: { kind: "backup", tag: "pre-upgrade" } as never,
      },
      { user: w.user },
    );
    expect(command.kind).toBe("backup");
    expect(command.payload).toMatchObject({
      app: machineApp,
      environment: "production",
      tag: "pre-upgrade",
    });

    const read = await api.getAppBackupCommand(
      { params: { ...params(w), commandId: command.id } },
      { user: w.user },
    );
    expect(read.id).toBe(command.id);
  });

  it("refuses a real restore without a reason", async ({ expect }) => {
    const { w } = await deployed();
    await expect(
      api.sendAppBackupCommand(
        {
          params: params(w),
          body: {
            kind: "restore",
            restore: { key: "k.tar.zst" },
          } as never,
        },
        { user: w.user },
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses a restore from another instance: only the estate's owner may ask", async ({
    expect,
  }) => {
    const { w } = await deployed();
    await expect(
      api.sendAppBackupCommand(
        {
          params: params(w),
          body: {
            kind: "restore",
            from: "other-project-app/production",
            reason: "borrowing another project's data",
          } as never,
        },
        { user: w.user },
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses a policy change: Bay's operator layer is the estate owner's", async ({
    expect,
  }) => {
    const { w, estate } = await deployed();
    const now = new Date().toISOString();
    await w.rows.estates.updateById(estate.id, {
      connectedAt: now,
      lastSeenAt: now,
    });
    await expect(
      api.sendAppBackupCommand(
        {
          params: params(w),
          body: {
            kind: "backup-policy",
            policy: { retention: { keep: 0 } },
          } as never,
        },
        { user: w.user },
      ),
    ).rejects.toThrow(/reserved to the estate's owner/);
  });

  it("refuses a restore while the Bay is offline, and queues it once connected", async ({
    expect,
  }) => {
    const { w, estate } = await deployed();
    const send = (body: object) =>
      api.sendAppBackupCommand(
        { params: params(w), body: body as never },
        { user: w.user },
      );
    const restore = { kind: "restore", reason: "the import went wrong" };

    await expect(send(restore)).rejects.toThrow(/not connected/);
    // A plain backup still queues: it is harmless whenever it runs.
    expect((await send({ kind: "backup" })).kind).toBe("backup");

    const now = new Date().toISOString();
    await w.rows.estates.updateById(estate.id, {
      connectedAt: now,
      lastSeenAt: now,
    });
    expect((await send(restore)).kind).toBe("restore");
  });

  it("answers 404 for another app's command on the same estate, and for a non-backup command", async ({
    expect,
  }) => {
    const a = await deployed("minpricing");
    const otherInstance = await createInstance(
      alepha,
      a.w,
      "shop",
      "production",
    );
    await a.w.rows.instances.updateById(otherInstance.id, {
      estateId: a.estate.id,
      resourceName: `p${a.w.project.id}-shop-production`,
      resourceEstateId: a.estate.id,
    });

    const theirs = await api.sendAppBackupCommand(
      { params: params(a.w, "shop"), body: { kind: "backups-list" } as never },
      { user: a.w.user },
    );
    await expect(
      api.getAppBackupCommand(
        { params: { ...params(a.w), commandId: theirs.id } },
        { user: a.w.user },
      ),
    ).rejects.toThrow(NotFoundError);

    const restart = await a.w.rows.commands.create({
      estateId: a.estate.id,
      kind: "restart",
      payload: { app: a.machineApp, environment: "production" },
      timeoutSeconds: 120,
    } as never);
    await expect(
      api.getAppBackupCommand(
        { params: { ...params(a.w), commandId: restart.id } },
        { user: a.w.user },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a command once the estate is no longer lent", async ({
    expect,
  }) => {
    const { w, estate } = await deployed();
    await w.rows.grants.deleteMany({ estateId: { eq: estate.id } });
    await expect(
      api.sendAppBackupCommand(
        { params: params(w), body: { kind: "backup" } as never },
        { user: w.user },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("never drives an instance the copy did not deploy as on its current estate", async ({
    expect,
  }) => {
    // Deployed on one estate, then moved to another the project was lent,
    // where the same name is ANOTHER project's live instance (that project
    // took the slug this one was renamed away from).
    const { w, instance } = await deployed();
    const elsewhere = await lentBayEstate(w);
    await w.rows.instances.updateById(instance.id, {
      estateId: elsewhere.id,
    });

    const view = await api.getAppBackup(
      { params: params(w), query: {} },
      { user: w.user },
    );
    expect(view.status).toBe("not-deployed");
    expect(view.machineApp).toBeUndefined();
    await expect(
      api.sendAppBackupCommand(
        { params: params(w), body: { kind: "backup" } as never },
        { user: w.user },
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("does not give a copy moved away and back its old instance again", async ({
    expect,
  }) => {
    // Moved off E and back, without a deploy in between: on E the name may now
    // belong to another project's copy (it took the slug meanwhile), so only a
    // new deploy - which checks the name is free - may hand the tab back.
    const { w, estate, instance } = await deployed();
    const elsewhere = await lentBayEstate(w);
    const apps = alepha.inject(AppService);
    const moved = await apps.setEstate(instance as never, elsewhere.id);
    await apps.setEstate(moved, estate.id);

    const view = await api.getAppBackup(
      { params: params(w), query: {} },
      { user: w.user },
    );
    expect(view.status).toBe("not-deployed");
  });
});
