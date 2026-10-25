import type { CapacitorUpdaterPlugin } from "@capgo/capacitor-updater";

import type { OtaBundle, OtaLatest } from "../interfaces/OtaBundle.ts";
import { UpdaterAdapter } from "./UpdaterAdapter.ts";

/**
 * The pinned `@capgo/capacitor-updater` 8.52.1, on a native shell whose
 * config sets `autoUpdate: false`, the three `/ota` URLs, `publicKey` and
 * `allowManualBundleError: true`.
 *
 * The plugin is loaded on first use, so a shell that never reaches the
 * updater never runs its module.
 */
export class CapgoUpdaterAdapter extends UpdaterAdapter {
  protected plugin?: Promise<{ updater: CapacitorUpdaterPlugin }>;

  public override available(): boolean {
    return true;
  }

  public override async configure(urls: {
    updateUrl: string;
    statsUrl: string;
    channelUrl: string;
  }): Promise<void> {
    await this.call((it) => it.setUpdateUrl({ url: urls.updateUrl }));
    await this.call((it) => it.setStatsUrl({ url: urls.statsUrl }));
    await this.call((it) => it.setChannelUrl({ url: urls.channelUrl }));
  }

  public override async notifyAppReady(): Promise<void> {
    await this.call((it) => it.notifyAppReady());
  }

  public override async current(): Promise<OtaBundle> {
    return this.bundle((await this.call((it) => it.current())).bundle);
  }

  public override async list(): Promise<OtaBundle[]> {
    const { bundles } = await this.call((it) => it.list());
    return bundles.map((it) => this.bundle(it));
  }

  public override async next(): Promise<OtaBundle | undefined> {
    const next = await this.call((it) => it.getNextBundle());
    return next ? this.bundle(next) : undefined;
  }

  public override async failed(): Promise<OtaBundle | undefined> {
    const failed = await this.call((it) => it.getFailedUpdate());
    return failed?.bundle ? this.bundle(failed.bundle) : undefined;
  }

  public override async check(): Promise<OtaLatest> {
    const latest = await this.call((it) => it.getLatest());
    return {
      version: latest.version,
      url: latest.url,
      sessionKey: latest.sessionKey,
      checksum: latest.checksum,
      error: latest.error,
      kind: latest.kind,
      message: latest.message,
      statusCode: latest.statusCode,
    };
  }

  public override async download(options: {
    url: string;
    version: string;
    sessionKey: string;
    checksum: string;
  }): Promise<OtaBundle> {
    return this.bundle(await this.call((it) => it.download(options)));
  }

  public override async setNext(id: string): Promise<void> {
    await this.call((it) => it.next({ id }));
  }

  public override async markFailed(id: string): Promise<void> {
    await this.call((it) => it.setBundleError({ id }));
  }

  public override async delete(id: string): Promise<void> {
    await this.call((it) => it.delete({ id }));
  }

  public override async setChannel(
    channel: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.call((it) => it.setChannel({ channel }));
      return result.error ? { ok: false, error: result.error } : { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Call the plugin, loaded once. The proxy never travels through a promise:
   * a Capacitor plugin proxy answers every property, `then` included, so a
   * promise resolved with it takes it for a thenable and never settles. It
   * is held in an object and used synchronously.
   */
  protected async call<T>(
    action: (updater: CapacitorUpdaterPlugin) => Promise<T>,
  ): Promise<T> {
    this.plugin ??= import("@capgo/capacitor-updater").then((it) => ({
      updater: it.CapacitorUpdater,
    }));
    const { updater } = await this.plugin;
    return action(updater);
  }

  protected bundle(it: {
    id: string;
    version: string;
    status: string;
  }): OtaBundle {
    return {
      id: it.id,
      version: it.version,
      status: it.status as OtaBundle["status"],
    };
  }
}
