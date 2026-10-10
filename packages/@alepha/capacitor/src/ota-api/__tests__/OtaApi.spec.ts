import { randomUUID } from "node:crypto";

import { describe, it } from "vitest";

import { otaWireFixtures } from "../../ota/protocol/__fixtures__/otaWireFixtures.ts";
import type { OtaReleaseManifest } from "../../ota/protocol/otaReleaseManifestSchema.ts";
import { otaUpdateResponseSchema } from "../../ota/protocol/otaUpdateResponseSchema.ts";
import type { OtaAppEntity } from "../entities/otaApps.ts";
import { OtaPublishService } from "../services/OtaPublishService.ts";
import { createOtaTestApp, operator, viewer } from "./otaTestApp.ts";

/**
 * A storage that is down for the first write, as a crash between the row
 * and the artifact would leave it.
 */
class FlakyPublishService extends OtaPublishService {
  public failures = 1;

  protected override async store(
    app: OtaAppEntity,
    manifest: OtaReleaseManifest,
    ciphertext: Uint8Array,
  ): Promise<string> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error("storage down");
    }
    return super.store(app, manifest, ciphertext);
  }
}

describe.each(["sqlite", "postgres"] as const)("ota-api on %s", (dialect) => {
  describe("update selection", () => {
    it("serves the channel's active bundle to an exact build, and nothing to other builds", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const bundle = await ctx.publish(
        ctx.release(app.appId, { builds: ["1", "2"] }),
      );

      const hit = await ctx.check(ctx.device(app.appId, { version_code: "2" }));
      expect(hit.status).toBe(200);
      expect(hit.body).toMatchObject({ version: bundle.version });
      expect(otaUpdateResponseSchema.parse(hit.body)).toBeTruthy();

      // A newer binary that no release lists, however compatible it might
      // be, gets nothing: compatibility is the exact list.
      const newer = await ctx.check(
        ctx.device(app.appId, { version_code: "3" }),
      );
      expect(newer.body).toMatchObject({
        kind: "blocked",
        error: "unknown_native_build",
      });

      const otherPlatform = await ctx.check(
        ctx.device(app.appId, { platform: "android", version_code: "1" }),
      );
      expect(otherPlatform.body).toMatchObject({ kind: "blocked" });

      const unknown = await ctx.check(ctx.device("dev.alepha.nobody"));
      expect(unknown.body).toMatchObject({
        kind: "blocked",
        error: "unknown_app",
      });
    });

    it("answers up to date to a device already running the target", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const bundle = await ctx.publish(ctx.release(app.appId));
      const answer = await ctx.check(
        ctx.device(app.appId, { version_name: bundle.version }),
      );
      expect(answer.body).toEqual(otaWireFixtures.updateNone.body);
    });

    it("reads the captured plugin requests", async ({ expect }) => {
      const ctx = await createOtaTestApp(dialect);
      const answer = await ctx.check(
        otaWireFixtures.updateRequestIos.body as never,
      );
      expect(answer.body).toMatchObject({
        kind: "blocked",
        error: "unknown_app",
      });
    });

    it("rolls out by a stable hash: 0 is nobody, 100 is everybody, 10 is about a tenth", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const first = await ctx.publish(ctx.release(app.appId));
      const second = await ctx.publish(ctx.release(app.appId, { rollout: 10 }));

      const versions = await Promise.all(
        Array.from({ length: 200 }, async () => {
          const answer = await ctx.check(ctx.device(app.appId));
          return (answer.body as { version: string }).version;
        }),
      );
      const share = versions.filter((it) => it === second.version).length;
      // Outside the rollout: the previous active, never nothing.
      expect(
        versions.every((it) => it === first.version || it === second.version),
      ).toBe(true);
      expect(share).toBeGreaterThan(5);
      expect(share).toBeLessThan(45);

      // The same device lands in the same bucket every time.
      const device = ctx.device(app.appId);
      const once = (await ctx.check(device)).body;
      expect((await ctx.check(device)).body).toMatchObject({
        version: (once as { version: string }).version,
      });

      const channel = (
        await ctx.admin.otaListChannels(
          { params: { id: app.id } },
          { user: operator },
        )
      )[0];
      const cohort = channel.cohorts[0].key;
      await ctx.admin.otaSetRollout(
        { params: { id: channel.id }, body: { cohort, rollout: 0 } },
        { user: operator },
      );
      for (let i = 0; i < 20; i++) {
        expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
          version: first.version,
        });
      }
      await ctx.admin.otaSetRollout(
        { params: { id: channel.id }, body: { cohort, rollout: 100 } },
        { user: operator },
      );
      for (let i = 0; i < 20; i++) {
        expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
          version: second.version,
        });
      }
    });

    it("resets to the built-in layer when a killed first release has nothing to fall back on", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const bundle = await ctx.publish(ctx.release(app.appId));
      await ctx.admin.otaKillBundle(
        { params: { id: bundle.id }, body: { reason: "broken" } },
        { user: operator },
      );

      // A device running it is sent back to its built-in layer.
      expect(
        (
          await ctx.check(
            ctx.device(app.appId, { version_name: bundle.version }),
          )
        ).body,
        // Nothing but the version: the updater rejects a check carrying a
        // `message`, and the device never reset.
      ).toEqual({ version: "builtin" });
      // A device on its built-in layer (maybe holding it, pending) is told
      // it is up to date, which cancels what it holds.
      expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
        kind: "up_to_date",
      });
    });

    it("falls back to the previous active when the active one is killed", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const good = await ctx.publish(ctx.release(app.appId));
      const bad = await ctx.publish(ctx.release(app.appId));
      await ctx.admin.otaKillBundle(
        { params: { id: bad.id }, body: {} },
        { user: operator },
      );
      expect(
        (await ctx.check(ctx.device(app.appId, { version_name: bad.version })))
          .body,
      ).toMatchObject({ version: good.version });
    });

    it("lets an override win, and a kill win over the override", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const pinned = await ctx.publish(ctx.release(app.appId));
      const latest = await ctx.publish(ctx.release(app.appId));
      const device = ctx.device(app.appId);

      await ctx.admin.otaSetOverride(
        {
          body: {
            appRef: app.id,
            deviceId: device.device_id,
            bundleId: pinned.id,
          },
        },
        { user: operator },
      );
      expect((await ctx.check(device)).body).toMatchObject({
        version: pinned.version,
      });
      // Another device still follows the channel.
      expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
        version: latest.version,
      });

      await ctx.admin.otaKillBundle(
        { params: { id: pinned.id }, body: {} },
        { user: operator },
      );
      expect((await ctx.check(device)).body).toMatchObject({
        version: latest.version,
      });
    });

    it("puts a device on a private channel only through an operator", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      await ctx.admin.otaCreateChannel(
        { body: { appRef: app.id, name: "qa" } },
        { user: operator },
      );
      const prod = await ctx.publish(ctx.release(app.appId));
      const qa = await ctx.publish(ctx.release(app.appId, { channel: "qa" }));

      // Asking for it is not enough: the channel is not self-assignable.
      const asking = ctx.device(app.appId, { defaultChannel: "qa" });
      expect((await ctx.check(asking)).body).toMatchObject({
        version: prod.version,
      });
      expect(
        (await ctx.updates.setChannel({ ...asking, channel: "qa" })).status,
      ).toBe(403);

      await ctx.admin.otaSetOverride(
        { body: { appRef: app.id, deviceId: asking.device_id, channel: "qa" } },
        { user: operator },
      );
      expect((await ctx.check(asking)).body).toMatchObject({
        version: qa.version,
      });
    });

    it("lets a device pick a self-assignable channel, and only that", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const beta = await ctx.admin.otaCreateChannel(
        { body: { appRef: app.id, name: "beta", allowSelfAssign: true } },
        { user: operator },
      );
      await ctx.publish(ctx.release(app.appId));
      const betaBundle = await ctx.publish(
        ctx.release(app.appId, { channel: "beta" }),
      );
      const device = ctx.device(app.appId, { channel: "beta" });

      expect(await ctx.updates.setChannel(device)).toMatchObject({
        status: 200,
      });
      expect(
        (await ctx.check({ ...device, defaultChannel: "beta" })).body,
      ).toMatchObject({ version: betaBundle.version });
      expect(
        await ctx.updates.setChannel({ ...device, channel: "production" }),
      ).toMatchObject({ body: { unset: true } });
      expect(await ctx.updates.listChannels(app.appId)).toEqual([
        { id: 1, name: "beta", public: false, allow_self_set: true },
        { id: 2, name: "production", public: true, allow_self_set: false },
      ]);

      await ctx.admin.otaUpdateChannel(
        { params: { id: beta.id }, body: { allowSelfAssign: false } },
        { user: operator },
      );
      expect(
        (await ctx.check({ ...device, defaultChannel: "beta" })).body,
      ).not.toMatchObject({ version: betaBundle.version });
    });

    it("never offers a device the bundle it rolled back from", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const good = await ctx.publish(ctx.release(app.appId));
      const bad = await ctx.publish(ctx.release(app.appId));
      const device = ctx.device(app.appId, { version_name: good.version });

      await ctx.updates.stats([
        { ...device, version_name: bad.version, action: "update_fail" },
      ]);
      expect((await ctx.check(device)).body).toMatchObject({
        kind: "up_to_date",
      });
      expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
        version: bad.version,
      });
    });

    it("rolls a whole cohort back to an older version", async ({ expect }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const v1 = await ctx.publish(
        ctx.release(app.appId, { version: "1.0.1" }),
      );
      await ctx.publish(ctx.release(app.appId, { version: "1.0.2" }));
      const channel = (
        await ctx.admin.otaListChannels(
          { params: { id: app.id } },
          { user: operator },
        )
      )[0];
      await ctx.admin.otaRollback(
        { params: { id: channel.id }, body: { bundleId: v1.id } },
        { user: operator },
      );
      expect(
        (await ctx.check(ctx.device(app.appId, { version_name: "1.0.2" })))
          .body,
      ).toMatchObject({ version: "1.0.1" });
    });
  });

  describe("publishing", () => {
    it("takes an upload from a bound API key, once, and refuses everything else", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const key = await ctx.publisherKey();
      const unbound = await ctx.publisherKey();
      const app = await ctx.app({ allowKey: key.id });
      const other = await ctx.app({ allowKey: unbound.id });
      const release = ctx.release(app.appId);

      expect((await ctx.upload(release)).status).toBe(401);
      // Cross-app: a key bound to another app may not publish here.
      expect((await ctx.upload(release, unbound.token)).status).toBe(403);
      expect(
        (await ctx.upload(ctx.release(other.appId), key.token)).status,
      ).toBe(403);

      const first = await ctx.upload(release, key.token);
      expect(first.status).toBe(201);
      expect(await first.json()).toMatchObject({
        id: release.manifest.id,
        created: true,
      });
      // A retry of the same release succeeds without a second bundle.
      const retry = await ctx.upload(release, key.token);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ created: false });

      // The same id with other content, the same version under another id.
      const forged = ctx.release(app.appId, { id: release.manifest.id });
      expect((await ctx.upload(forged, key.token)).status).toBe(409);
      const twin = ctx.release(app.appId, {
        version: release.manifest.version,
      });
      expect((await ctx.upload(twin, key.token)).status).toBe(409);
    });

    it("verifies the bundle against the app's key and its own manifest", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();

      const otherKey = ctx.release(app.appId, {
        privateKey: ctx.otherKeys.privateKey,
      });
      await expect(ctx.publish(otherKey)).rejects.toThrow(
        "not encrypted with this app's key",
      );

      const tampered = ctx.release(app.appId);
      const bytes = tampered.ciphertext.slice();
      bytes[10] ^= 0xff;
      await expect(
        ctx.publish({ manifest: tampered.manifest, ciphertext: bytes }),
      ).rejects.toThrow("ciphertext size and digest");

      const lying = ctx.release(app.appId);
      lying.manifest.archive.files = 9;
      await expect(ctx.publish(lying)).rejects.toThrow(
        "does not hold what the manifest says",
      );

      const noIndex = ctx.release(app.appId);
      await expect(
        ctx.publish({
          ...noIndex,
          manifest: { ...noIndex.manifest, keyId: "MIIBCgKCAQEAxxxxxxxx" },
        }),
      ).rejects.toThrow("sealed for key");
    });

    it("refuses a build number already published with another fingerprint", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      await ctx.publish(
        ctx.release(app.appId, { builds: ["1"], fingerprint: "f1" }),
      );
      await expect(
        ctx.publish(
          ctx.release(app.appId, { builds: ["1", "2"], fingerprint: "f2" }),
        ),
      ).rejects.toThrow("another native fingerprint");
      // A new binary with new plugins publishes under its own build number.
      const next = await ctx.publish(
        ctx.release(app.appId, { builds: ["2"], fingerprint: "f2" }),
      );
      expect(
        (await ctx.check(ctx.device(app.appId, { version_code: "2" }))).body,
      ).toMatchObject({
        version: next.version,
      });
    });

    it("finishes an upload a crash left half done", async ({ expect }) => {
      const ctx = await createOtaTestApp(dialect, (alepha) =>
        alepha.with({ provide: OtaPublishService, use: FlakyPublishService }),
      );
      const app = await ctx.app();
      const release = ctx.release(app.appId);
      await expect(ctx.publish(release)).rejects.toThrow("storage down");
      expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
        kind: "blocked",
      });

      const bundle = await ctx.publish(release);
      expect(bundle.status).toBe("ready");
      expect((await ctx.check(ctx.device(app.appId))).body).toMatchObject({
        version: bundle.version,
      });
    });
  });

  describe("delivery", () => {
    it("streams a bundle behind a live link, and refuses an expired or altered one", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const release = ctx.release(app.appId);
      await ctx.publish(release);
      const answer = (await ctx.check(ctx.device(app.appId))).body as {
        url: string;
      };

      const ok = await fetch(answer.url);
      expect(ok.status).toBe(200);
      expect(new Uint8Array(await ok.arrayBuffer())).toEqual(
        release.ciphertext,
      );

      const altered = answer.url.replace(
        /token=(\d+)\./,
        (_, at) => `token=${Number(at) + 1}.`,
      );
      expect((await fetch(altered)).status).toBe(403);

      await ctx.dateTime.travel(11, "minutes");
      expect((await fetch(answer.url)).status).toBe(403);
    });

    it("stops serving a killed bundle, even on a live link", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const bundle = await ctx.publish(ctx.release(app.appId));
      const answer = (await ctx.check(ctx.device(app.appId))).body as {
        url: string;
      };
      await ctx.admin.otaKillBundle(
        { params: { id: bundle.id }, body: {} },
        { user: operator },
      );
      expect((await fetch(answer.url)).status).toBe(410);
    });

    it("answers the plugin over HTTP with its own shapes", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const post = (
        path: string,
        body: unknown,
        method: "POST" | "PUT" = "POST",
      ) =>
        fetch(`${ctx.hostname}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

      const none = await post("/ota/updates", ctx.device(app.appId));
      expect(none.status).toBe(200);
      expect(await none.json()).toMatchObject({ kind: "blocked" });

      const stats = await post("/ota/stats", otaWireFixtures.statsBatch.body);
      expect(await stats.json()).toEqual({ status: "ok" });
      expect(
        (
          await post(
            "/ota/stats",
            Array.from({ length: 201 }, () => otaWireFixtures.statsSingle.body),
          )
        ).status,
      ).toBe(400);

      const refused = await post("/ota/channel", {
        ...ctx.device(app.appId),
        channel: "nope",
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: "channel_self_set_not_allowed",
      });

      const get = await post("/ota/channel", ctx.device(app.appId), "PUT");
      expect(await get.json()).toEqual({
        channel: "production",
        status: "default",
        allowSet: true,
      });

      const list = await fetch(
        `${ctx.hostname}/ota/channel?${new URLSearchParams({ ...(otaWireFixtures.channelListRequest.query as Record<string, string>), app_id: app.appId })}`,
      );
      expect(await list.json()).toEqual([
        { id: 1, name: "production", public: true, allow_self_set: false },
      ]);
    });
  });

  describe("permissions", () => {
    it("enforces read, manage and release on the server", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      expect(await ctx.admin.otaListApps({}, { user: viewer })).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: app.id })]),
      );
      await expect(
        ctx.admin.otaCreateChannel(
          { body: { appRef: app.id, name: "sneaky" } },
          { user: viewer },
        ),
      ).rejects.toThrow("ota:manage");
      await expect(
        ctx.admin.otaKillBundle(
          { params: { id: randomUUID() }, body: {} },
          { user: viewer },
        ),
      ).rejects.toThrow("ota:manage");
      await expect(
        ctx.admin.otaListApps(
          {},
          { user: { id: randomUUID(), realm: "users", roles: [] } },
        ),
      ).rejects.toThrow("ota:read");
    });

    it("bounds a rollout to 0-100", async ({ expect }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      await ctx.publish(ctx.release(app.appId));
      const channel = (
        await ctx.admin.otaListChannels(
          { params: { id: app.id } },
          { user: operator },
        )
      )[0];
      for (const rollout of [-1, 101]) {
        await expect(
          ctx.admin.otaSetRollout(
            {
              params: { id: channel.id },
              body: { cohort: channel.cohorts[0].key, rollout },
            },
            { user: operator },
          ),
        ).rejects.toThrow();
      }
    });

    it("refuses a public key that is not one", async ({ expect }) => {
      const ctx = await createOtaTestApp(dialect);
      await expect(ctx.app({ publicKey: ctx.keys.privateKey })).rejects.toThrow(
        "PKCS#1",
      );
    });
  });

  describe("retention", () => {
    it("keeps the last ten per cohort and everything still referenced", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const published = [];
      for (let i = 0; i < 13; i++) {
        published.push(
          await ctx.publish(ctx.release(app.appId, { version: `1.0.${i}` })),
        );
      }
      // The oldest is pinned for a QA device: kept whatever its age.
      await ctx.admin.otaSetOverride(
        {
          body: {
            appRef: app.id,
            deviceId: "qa-phone",
            bundleId: published[0].id,
          },
        },
        { user: operator },
      );

      const result = await ctx.retention.run();
      expect(result.deleted).toBe(2);
      const states = Object.fromEntries(
        (
          await ctx.admin.otaListBundles(
            { params: { id: app.id } },
            { user: operator },
          )
        ).map((it) => [it.version, it.status]),
      );
      expect(states["1.0.0"]).toBe("ready");
      expect(states["1.0.1"]).toBe("deleted");
      expect(states["1.0.2"]).toBe("deleted");
      expect(states["1.0.3"]).toBe("ready");
      expect(states["1.0.12"]).toBe("ready");

      // A deleted version is never reused.
      await expect(
        ctx.publish(ctx.release(app.appId, { version: "1.0.1" })),
      ).rejects.toThrow("already exists");
    });

    it("spares a bundle whose download link may still be live", async ({
      expect,
    }) => {
      const ctx = await createOtaTestApp(dialect);
      const app = await ctx.app();
      const old = await ctx.publish(
        ctx.release(app.appId, { version: "2.0.0" }),
      );
      // Ten newer releases push it out of the retention window, but a
      // device outside a rollout was just handed a link to it.
      for (let i = 1; i <= 10; i++) {
        await ctx.publish(ctx.release(app.appId, { version: `2.0.${i}` }));
      }
      await ctx.publisher["bundles"].updateById(old.id, {
        lastLinkAt: ctx.dateTime.nowISOString(),
      });
      expect((await ctx.retention.run()).deleted).toBe(0);
      await ctx.dateTime.travel(11, "minutes");
      expect((await ctx.retention.run()).deleted).toBe(1);
    });
  });
});
