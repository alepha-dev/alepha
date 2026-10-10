import { Capacitor } from "@capacitor/core";
import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { CapacitorConfigProvider } from "../../core/providers/CapacitorConfigProvider.ts";
import type { OtaBundle, OtaLatest } from "../interfaces/OtaBundle.ts";
import { OtaLocalState } from "../services/OtaLocalState.ts";
import { UpdaterAdapter } from "./UpdaterAdapter.ts";

/**
 * The device side of live updates: a manual, self-hosted policy over the
 * pinned updater.
 *
 * **Health.** On every configured, non-dev native boot (built-in or live
 * layer alike) the updater is told the layer is healthy once the first
 * screen settles healthy (`react:boot:settled`), the offline screen
 * included: an unreachable or stalled API never rolls a working bundle
 * back, and nothing waits for the API, the session or a protected loader.
 * A failed first screen is never acknowledged, so the updater reverts it.
 *
 * **Checks.** On boot and on every return to the foreground, one at a time:
 * the server names the bundle this device should run, and the device
 * reconciles:
 *
 * - a bundle it does not have: download, verify (the plugin checks the
 *   Capgo v2 envelope and checksum), and apply it on the next background
 *   or restart (`next`). Never a reload in front of the user;
 * - a bundle it already holds, an older one included (a rollback): apply
 *   that one on the next background;
 * - "up to date": whatever it holds waiting is cancelled (a kill switch, a
 *   rollback, a rollout pulled back reach the device this way);
 * - `builtin`: back to the binary's own layer on the next background;
 * - blocked or failed: nothing changes.
 *
 * A failed download is retried once at once with a fresh check (a link may
 * have expired), then on later resumes with a growing delay. A bundle the
 * updater rolled back from, or that failed to download twice, is never
 * fetched again on this device. The kill switch reaches a device at its next
 * contact: nothing can undo a bundle on a device that stays offline.
 *
 * Inert, and saying why in the log, in a browser, in `dev` mode, and in a
 * shell built without the updater.
 */
export class OtaProvider {
  protected readonly log = $logger();
  protected readonly config = $inject(CapacitorConfigProvider);
  protected readonly updater = $inject(UpdaterAdapter);
  protected readonly state = $inject(OtaLocalState);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected enabled = false;
  protected acknowledged = false;
  protected inFlight?: Promise<void>;

  protected readonly onReady = $hook({
    on: "ready",
    handler: async () => {
      const reason = this.inertReason();
      if (reason) {
        this.log.info(`Live updates are off: ${reason}`);
        return;
      }
      const origin = this.config.get()?.ota?.url ?? "";
      try {
        await this.updater.configure({
          updateUrl: `${origin}/ota/updates`,
          statsUrl: `${origin}/ota/stats`,
          channelUrl: `${origin}/ota/channel`,
        });
      } catch (error) {
        this.log.error(
          "Live updates are off: the updater refused its URLs",
          error,
        );
        return;
      }
      this.enabled = true;
      try {
        const failed = await this.updater.failed();
        if (failed) {
          this.state.exclude(failed.version);
          this.log.warn("The updater rolled back a live update", {
            version: failed.version,
          });
        }
      } catch (error) {
        this.log.warn("Could not read the updater's last failure", error);
      }
    },
  });

  protected readonly onSettled = $hook({
    on: "react:boot:settled",
    handler: async ({ outcome }) => {
      if (!this.enabled) {
        return;
      }
      if (outcome !== "healthy") {
        this.log.error(
          "The first screen failed: this web layer is not acknowledged, and the updater will roll it back",
        );
        return;
      }
      await this.acknowledge();
      void this.check();
    },
  });

  protected readonly onAppState = $hook({
    on: "capacitor:app:state",
    handler: ({ active }) => {
      if (this.enabled && active && this.acknowledged) {
        void this.check();
      }
    },
  });

  /**
   * Whether live updates run in this shell.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check for an update now, unless a check is already running (the same
   * one is returned). Never throws.
   */
  public check(): Promise<void> {
    if (!this.enabled) {
      return Promise.resolve();
    }
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /**
   * Resolves once no check is running.
   */
  public idle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /**
   * Put this device on a channel it may pick itself. The server refuses a
   * channel that is not self-assignable; a private channel is an operator's
   * device override, never this.
   */
  public async setChannel(
    channel: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.enabled) {
      return { ok: false, error: "live updates are off" };
    }
    const result = await this.updater.setChannel(channel);
    if (result.ok) {
      void this.check();
    }
    return result;
  }

  /**
   * Why live updates are off here, or nothing when they run.
   */
  protected inertReason(): string | undefined {
    const config = this.config.get();
    if (!config) {
      return "not a capacitor-built shell";
    }
    if (config.mode === "dev") {
      return "a development shell, served by the dev server";
    }
    if (!config.ota) {
      return "the shell was built without an updater (capacitor({ ota }))";
    }
    if (!this.isNative()) {
      return "not running on a native platform";
    }
    if (!this.updater.available()) {
      return "the updater plugin is not installed";
    }
    return undefined;
  }

  /**
   * Whether the WebView runs inside the native shell. A method so a spec can
   * say yes.
   */
  protected isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  protected async acknowledge(): Promise<void> {
    if (this.acknowledged) {
      return;
    }
    try {
      await this.updater.notifyAppReady();
      this.acknowledged = true;
    } catch (error) {
      this.log.error("Could not acknowledge this web layer", error);
    }
  }

  protected async run(): Promise<void> {
    if (!this.state.mayRetry(this.dateTime.nowMillis())) {
      return;
    }
    try {
      let outcome = await this.apply(await this.updater.check());
      if (outcome === "retry") {
        // One fresh check at once: the link may have expired while the
        // download waited.
        outcome = await this.apply(await this.updater.check());
      }
      if (outcome === "done") {
        this.state.succeeded();
      } else {
        this.state.failedAttempt(this.dateTime.nowMillis());
      }
    } catch (error) {
      this.log.warn("Live update check failed", error);
      this.state.failedAttempt(this.dateTime.nowMillis());
    }
  }

  /**
   * Act on one answer: `done`, `retry` when a download failed and a fresh
   * check is worth it, `failed` when the server did not answer.
   */
  protected async apply(
    latest: OtaLatest,
  ): Promise<"done" | "retry" | "failed"> {
    if (latest.kind === "up_to_date") {
      await this.cancelPending();
      return "done";
    }
    if (latest.version === "builtin") {
      const current = await this.updater.current();
      if (current.id !== "builtin") {
        await this.cancelPending();
        await this.updater.setNext("builtin");
        this.log.warn(
          "Resetting to the built-in web layer on the next restart",
        );
      }
      return "done";
    }
    if (!latest.url || !latest.version) {
      // Blocked by the server, or no answer: keep everything as it is.
      if (latest.kind === "failed") {
        this.log.debug("The update server did not answer", {
          error: latest.error,
          status: latest.statusCode,
        });
        return "failed";
      }
      return "done";
    }

    const version = latest.version;
    if (this.state.isExcluded(version)) {
      this.log.info("Skipping a live update that failed on this device", {
        version,
      });
      await this.cancelPending();
      return "done";
    }

    const current = await this.updater.current();
    if (current.version === version && current.id !== "builtin") {
      await this.cancelPending();
      return "done";
    }
    const next = await this.updater.next();
    if (next?.version === version && next.status !== "error") {
      return "done";
    }

    const held = (await this.updater.list()).find(
      (it) => it.version === version && it.status !== "error",
    );
    if (held) {
      await this.cancelPending(held.id);
      await this.updater.setNext(held.id);
      return "done";
    }

    let bundle: OtaBundle;
    try {
      bundle = await this.updater.download({
        url: latest.url,
        version,
        sessionKey: latest.sessionKey ?? "",
        checksum: latest.checksum ?? "",
      });
    } catch (error) {
      this.log.warn("A live update failed to download", { version, error });
      if (this.state.downloadFailed(version)) {
        this.log.warn("Giving up on a live update on this device", { version });
        return "done";
      }
      return "retry";
    }
    await this.cancelPending(bundle.id);
    await this.updater.setNext(bundle.id);
    this.log.info("A live update is ready for the next restart", { version });
    return "done";
  }

  /**
   * Cancel the bundle waiting to be applied, unless it is `keep`. Marked
   * failed, the only cancellation that holds on both platforms, then
   * deleted.
   */
  protected async cancelPending(keep?: string): Promise<void> {
    const next = await this.updater.next();
    if (!next || next.id === keep || next.status === "error") {
      return;
    }
    const current = await this.updater.current();
    if (next.id === current.id) {
      return;
    }
    if (next.id === "builtin") {
      // A reset waiting to happen that the server no longer asks for. The
      // updater has no way to withdraw it except pointing at another
      // bundle; the current one is a no-op on Android, so it stays.
      this.log.warn(
        "A pending reset to the built-in layer cannot be withdrawn",
      );
      return;
    }
    try {
      await this.updater.markFailed(next.id);
      await this.updater.delete(next.id);
      this.log.info("A pending live update was withdrawn", {
        version: next.version,
      });
    } catch (error) {
      this.log.warn("Could not withdraw a pending live update", error);
    }
  }
}
