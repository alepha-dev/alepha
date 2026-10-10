import { AlephaError } from "alepha";

import type { OtaBundle, OtaLatest } from "../interfaces/OtaBundle.ts";

/**
 * The live updater's native surface, as `OtaProvider` uses it: the subset
 * of the pinned `@capgo/capacitor-updater` 8.52.1 a manual, self-hosted
 * policy needs, behind a class a spec substitutes.
 *
 * This base is "no updater": inert in a browser, a test or a shell built
 * without the plugin. {@link CapgoUpdaterAdapter} is the native one,
 * {@link MemoryUpdaterAdapter} the spec's.
 */
export class UpdaterAdapter {
  /**
   * Whether a native updater answers.
   */
  public available(): boolean {
    return false;
  }

  /**
   * Point the updater at the app's own `/ota` endpoints. The native config
   * leaves them blank, so it holds nothing machine-specific.
   */
  public async configure(_urls: {
    updateUrl: string;
    statsUrl: string;
    channelUrl: string;
  }): Promise<void> {
    throw this.missing();
  }

  /**
   * Tell the updater this web layer booted: it stops waiting to roll it
   * back.
   */
  public async notifyAppReady(): Promise<void> {
    throw this.missing();
  }

  public async current(): Promise<OtaBundle> {
    throw this.missing();
  }

  /**
   * The bundles downloaded on this device, `builtin` excluded.
   */
  public async list(): Promise<OtaBundle[]> {
    throw this.missing();
  }

  /**
   * The bundle waiting to be applied on the next background or restart.
   */
  public async next(): Promise<OtaBundle | undefined> {
    throw this.missing();
  }

  /**
   * The bundle the updater rolled back from at the last boot, once.
   */
  public async failed(): Promise<OtaBundle | undefined> {
    throw this.missing();
  }

  /**
   * Ask the server which bundle this device should run.
   */
  public async check(): Promise<OtaLatest> {
    throw this.missing();
  }

  /**
   * Download, decrypt and verify a bundle. It is stored, not applied.
   */
  public async download(_options: {
    url: string;
    version: string;
    sessionKey: string;
    checksum: string;
  }): Promise<OtaBundle> {
    throw this.missing();
  }

  /**
   * Apply a bundle (or `builtin`) when the app next goes to the background
   * or restarts. Never reloads the page in front of the user.
   */
  public async setNext(_id: string): Promise<void> {
    throw this.missing();
  }

  /**
   * Mark a bundle failed: a pending one is then never applied. The only
   * cancellation that works on both platforms (on Android, `setNext` of the
   * current bundle is a no-op).
   */
  public async markFailed(_id: string): Promise<void> {
    throw this.missing();
  }

  public async delete(_id: string): Promise<void> {
    throw this.missing();
  }

  /**
   * Ask the server to put this device on a channel it may pick itself.
   */
  public async setChannel(
    _channel: string,
  ): Promise<{ ok: boolean; error?: string }> {
    throw this.missing();
  }

  protected missing(): AlephaError {
    return new AlephaError("No live updater is available in this shell");
  }
}
