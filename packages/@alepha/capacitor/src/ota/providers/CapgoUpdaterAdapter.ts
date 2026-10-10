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
  protected plugin?: Promise<CapacitorUpdaterPlugin>;

  public override available(): boolean {
    return true;
  }

  public override async configure(urls: {
    updateUrl: string;
    statsUrl: string;
    channelUrl: string;
  }): Promise<void> {
    const updater = await this.updater();
    await updater.setUpdateUrl({ url: urls.updateUrl });
    await updater.setStatsUrl({ url: urls.statsUrl });
    await updater.setChannelUrl({ url: urls.channelUrl });
  }

  public override async notifyAppReady(): Promise<void> {
    await (await this.updater()).notifyAppReady();
  }

  public override async current(): Promise<OtaBundle> {
    return this.bundle((await (await this.updater()).current()).bundle);
  }

  public override async list(): Promise<OtaBundle[]> {
    const { bundles } = await (await this.updater()).list();
    return bundles.map((it) => this.bundle(it));
  }

  public override async next(): Promise<OtaBundle | undefined> {
    const next = await (await this.updater()).getNextBundle();
    return next ? this.bundle(next) : undefined;
  }

  public override async failed(): Promise<OtaBundle | undefined> {
    const failed = await (await this.updater()).getFailedUpdate();
    return failed?.bundle ? this.bundle(failed.bundle) : undefined;
  }

  public override async check(): Promise<OtaLatest> {
    const latest = await (await this.updater()).getLatest();
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
    return this.bundle(await (await this.updater()).download(options));
  }

  public override async setNext(id: string): Promise<void> {
    await (await this.updater()).next({ id });
  }

  public override async markFailed(id: string): Promise<void> {
    await (await this.updater()).setBundleError({ id });
  }

  public override async delete(id: string): Promise<void> {
    await (await this.updater()).delete({ id });
  }

  public override async setChannel(
    channel: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await (await this.updater()).setChannel({ channel });
      return result.error ? { ok: false, error: result.error } : { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  protected updater(): Promise<CapacitorUpdaterPlugin> {
    this.plugin ??= import("@capgo/capacitor-updater").then(
      (it) => it.CapacitorUpdater,
    );
    return this.plugin;
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
