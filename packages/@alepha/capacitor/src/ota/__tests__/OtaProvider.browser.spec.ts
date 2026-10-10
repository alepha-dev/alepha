import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { ReactBootHealth } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

import {
  AlephaCapacitor,
  CapacitorConfigProvider,
  MemoryCapacitorConfigProvider,
  WebContentProvider,
} from "../../core/index.ts";
import type { CapacitorPublicConfig } from "../../core/schemas/capacitorPublicConfigSchema.ts";
import {
  AlephaCapacitorOta,
  MemoryUpdaterAdapter,
  OtaProvider,
  UpdaterAdapter,
} from "../index.ts";
import { otaWireFixtures } from "../protocol/__fixtures__/otaWireFixtures.ts";

/**
 * The real provider, on a native shell whatever jsdom's Capacitor says.
 */
class NativeOtaProvider extends OtaProvider {
  protected override isNative(): boolean {
    return true;
  }
}

const shell: CapacitorPublicConfig = {
  appId: "dev.alepha.mobile",
  variant: "base",
  scheme: "mobile",
  mode: "bundled",
  ota: { url: "https://api.test" },
  env: {},
};

const available = (
  version: string,
  url = `https://api.test/ota/bundles/${version}/download?token=1.x`,
) => ({
  status: 200,
  body: { ...otaWireFixtures.updateAvailable.body, version, url },
});
const none = () => ({ ...otaWireFixtures.updateNone });
const builtin = () => ({ ...otaWireFixtures.updateBuiltin });

const started: Alepha[] = [];

const boot = async (
  config: CapacitorPublicConfig | null = shell,
  prepare?: (updater: MemoryUpdaterAdapter) => void,
) => {
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: UpdaterAdapter, use: MemoryUpdaterAdapter })
    .with({ provide: OtaProvider, use: NativeOtaProvider })
    // In an app's order: core first, the updater after.
    .with(AlephaCapacitor)
    .with(AlephaCapacitorOta);
  alepha.inject(MemoryCapacitorConfigProvider).config = config ?? undefined;
  const updater = alepha.inject(MemoryUpdaterAdapter);
  const ota = alepha.inject(OtaProvider);
  prepare?.(updater);
  started.push(alepha);
  await alepha.start();
  const settle = async (outcome: "healthy" | "failed" = "healthy") => {
    alepha.inject(ReactBootHealth).report(outcome);
    // The outcome is read asynchronously, then the check starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ota.idle();
  };
  const resume = async () => {
    await alepha.events.emit("capacitor:app:state", { active: true });
    await ota.idle();
  };
  return { alepha, updater, ota, settle, resume };
};

describe("OtaProvider", () => {
  afterEach(async () => {
    // Stopped before jsdom goes: a running container keeps React's
    // scheduler busy past the test.
    for (const alepha of started.splice(0)) {
      await alepha.stop();
    }
    localStorage.clear();
  });

  describe("when it stays inert", () => {
    it("does nothing outside a shell, in dev, or without an updater", async ({
      expect,
    }) => {
      for (const config of [
        null,
        { ...shell, mode: "dev" as const },
        { ...shell, ota: undefined },
      ]) {
        const { updater, ota, settle } = await boot(config);
        await settle();
        expect(ota.isEnabled()).toBe(false);
        expect(updater.acknowledged).toBe(0);
        expect(updater.checks).toBe(0);
      }
    });
  });

  describe("health", () => {
    it("acknowledges a healthy first screen once, then checks", async ({
      expect,
    }) => {
      const { updater, settle } = await boot();
      await settle();
      await settle();
      expect(updater.acknowledged).toBe(1);
      expect(updater.checks).toBeGreaterThanOrEqual(1);
    });

    it("acknowledges a first screen that settled before the updater was ready", async ({
      expect,
    }) => {
      // Seen on the simulator: the boot outruns the updater's first native
      // calls, and an event-only listener missed it.
      const alepha = Alepha.create()
        .with({
          provide: CapacitorConfigProvider,
          use: MemoryCapacitorConfigProvider,
        })
        .with({ provide: UpdaterAdapter, use: MemoryUpdaterAdapter })
        .with({ provide: OtaProvider, use: NativeOtaProvider })
        .with(AlephaCapacitor)
        .with(AlephaCapacitorOta);
      alepha.inject(MemoryCapacitorConfigProvider).config = shell;
      started.push(alepha);
      alepha.inject(ReactBootHealth).report("healthy");
      await alepha.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await alepha.inject(OtaProvider).idle();
      expect(alepha.inject(MemoryUpdaterAdapter).acknowledged).toBe(1);
    });

    it("never acknowledges a failed first screen, nor checks", async ({
      expect,
    }) => {
      const { updater, settle } = await boot();
      await settle("failed");
      expect(updater.acknowledged).toBe(0);
      expect(updater.checks).toBe(0);
    });
  });

  describe("updates", () => {
    it("downloads in the background and applies on the next background only", async ({
      expect,
    }) => {
      const { updater, settle, alepha } = await boot();
      updater.answers.push(available("2.0.0"));
      await settle();

      expect(updater.downloads).toHaveLength(1);
      expect((await updater.current()).id).toBe("builtin");
      expect((await updater.next())?.version).toBe("2.0.0");

      updater.background();
      expect((await updater.current()).version).toBe("2.0.0");
      expect(await alepha.inject(WebContentProvider).content()).toMatchObject({
        mode: "ota",
        bundleVersion: "2.0.0",
      });
    });

    it("runs one check at a time, on boot and on resume", async ({
      expect,
    }) => {
      const { updater, ota, settle, resume } = await boot();
      await settle();
      const before = updater.checks;
      await Promise.all([ota.check(), ota.check(), ota.check()]);
      expect(updater.checks).toBe(before + 1);
      await resume();
      expect(updater.checks).toBe(before + 2);
    });

    it("checks once more at once when a download fails, then backs off", async ({
      expect,
    }) => {
      const { updater, ota, settle } = await boot();
      updater.broken.add(
        "https://api.test/ota/bundles/2.0.0/download?token=1.x",
      );
      updater.answers.push(
        available("2.0.0"),
        available("2.0.0", "https://api.test/fresh"),
      );
      await settle();
      expect(updater.downloads).toEqual([
        "https://api.test/ota/bundles/2.0.0/download?token=1.x",
        "https://api.test/fresh",
      ]);
      expect((await updater.next())?.version).toBe("2.0.0");

      // A server that does not answer: the next check waits.
      updater.answers.push(new Error("offline"));
      await ota.check();
      const checks = updater.checks;
      await ota.check();
      expect(updater.checks).toBe(checks);
    });

    it("gives up on a bundle that failed to download twice", async ({
      expect,
    }) => {
      const { updater, ota, settle } = await boot();
      const url = "https://api.test/ota/bundles/2.0.0/download?token=1.x";
      updater.broken.add(url);
      updater.answers.push(available("2.0.0", url), available("2.0.0", url));
      await settle();
      expect(updater.downloads).toEqual([url, url]);

      updater.answers.push(available("2.0.0", url));
      await ota.check();
      expect(updater.downloads).toHaveLength(2);
    });

    it("withdraws a pending bundle when the server says up to date (kill switch)", async ({
      expect,
    }) => {
      const { updater, ota, settle } = await boot();
      updater.answers.push(available("2.0.0"));
      await settle();
      const pending = await updater.next();
      expect(pending?.version).toBe("2.0.0");

      updater.answers.push(none());
      await ota.check();
      expect(updater.bundles.has(pending!.id)).toBe(false);
      updater.background();
      expect((await updater.current()).id).toBe("builtin");
    });

    it("withdraws a waiting bundle killed while the app stays in front", async ({
      expect,
    }) => {
      // Seen on the simulator: activation happens on background, before the
      // resume check could see the kill, so only a check in front is in time.
      const { alepha, updater, ota, settle } = await boot();
      updater.answers.push(available("2.0.0"));
      await settle();
      const pending = await updater.next();
      expect(pending?.version).toBe("2.0.0");

      updater.answers.push(none());
      await alepha.inject(DateTimeProvider).travel([10, "minutes"]);
      await ota.idle();
      expect(updater.bundles.has(pending!.id)).toBe(false);
      updater.background();
      expect((await updater.current()).id).toBe("builtin");
    });

    it("never checks on a timer while in the background", async ({
      expect,
    }) => {
      const { alepha, updater, ota, settle } = await boot();
      await settle();
      const checks = updater.checks;
      await alepha.events.emit("capacitor:app:state", { active: false });
      await alepha.inject(DateTimeProvider).travel([30, "minutes"]);
      await ota.idle();
      expect(updater.checks).toBe(checks);
    });

    it("resets to the built-in layer when told to", async ({ expect }) => {
      const { updater, ota, settle } = await boot();
      updater.answers.push(available("2.0.0"));
      await settle();
      updater.background();
      updater.answers.push(builtin());
      await ota.check();
      expect((await updater.next())?.id).toBe("builtin");
      updater.background();
      expect((await updater.current()).id).toBe("builtin");
    });

    it("rolls back to an older bundle it still holds, without downloading it", async ({
      expect,
    }) => {
      const { updater, ota, settle } = await boot();
      updater.answers.push(available("1.0.1"));
      await settle();
      updater.background();
      await updater.notifyAppReady();
      updater.answers.push(available("1.0.2"));
      await ota.check();
      updater.background();
      await updater.notifyAppReady();

      updater.answers.push(available("1.0.1"));
      await ota.check();
      expect(updater.downloads).toHaveLength(2);
      expect((await updater.next())?.version).toBe("1.0.1");
    });

    it("keeps everything as it is on a blocked answer", async ({ expect }) => {
      const { updater, ota, settle } = await boot();
      updater.answers.push(available("2.0.0"));
      await settle();
      updater.answers.push({ ...otaWireFixtures.updateBlocked });
      await ota.check();
      expect((await updater.next())?.version).toBe("2.0.0");
    });

    it("never fetches again a bundle the updater rolled back from", async ({
      expect,
    }) => {
      const first = await boot();
      first.updater.answers.push(available("2.0.0"));
      await first.settle();
      first.updater.background();
      first.updater.rollBack();

      // The next launch: the updater reports the failure, once.
      const { updater, ota, settle } = await boot(shell, (it) => {
        it.failedBundle = { id: "b1", version: "2.0.0", status: "error" };
      });
      await settle();
      updater.answers.push(available("2.0.0"));
      await ota.check();
      expect(updater.downloads).toHaveLength(0);
    });
  });

  describe("channels", () => {
    it("asks the server, which decides", async ({ expect }) => {
      const { ota, settle, updater } = await boot();
      await settle();
      expect(await ota.setChannel("beta")).toEqual({ ok: true });
      expect(await ota.setChannel("qa")).toEqual({
        ok: false,
        error: "channel_self_set_not_allowed",
      });
      expect(updater.channelRequests).toEqual(["beta", "qa"]);
    });
  });
});
