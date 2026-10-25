import { AlephaError } from "alepha";

import type { OtaBundle, OtaLatest } from "../interfaces/OtaBundle.ts";
import { UpdaterAdapter } from "./UpdaterAdapter.ts";

/**
 * The pinned updater's behaviour, in memory, for specs of the real
 * `OtaProvider`: the semantics measured on the simulator and the emulator
 * (#Q2524), Android's where the platforms differ.
 *
 * - `check()` answers what a spec queued in {@link answers}, decoded as the
 *   plugin decodes it (`session_key` into `sessionKey`);
 * - `download()` refuses what the plugin refuses (no session key, no
 *   checksum, a URL in {@link broken}) and stores a `pending` bundle;
 * - `setNext()` of the current successful bundle is a no-op, as on Android;
 * - {@link background} applies the next bundle unless it is marked failed;
 *   {@link rollBack} is the updater's own revert of an unacknowledged one.
 */
export class MemoryUpdaterAdapter extends UpdaterAdapter {
  public readonly bundles = new Map<string, OtaBundle>();
  public currentId = "builtin";
  public nextId?: string;
  public failedBundle?: OtaBundle;
  public readonly builtinVersion = "1.0";
  public acknowledged = 0;
  public checks = 0;
  public answers: Array<
    { status: number; body: Record<string, unknown> } | Error
  > = [];
  public readonly broken = new Set<string>();
  public readonly downloads: string[] = [];
  public readonly channelRequests: string[] = [];
  protected counter = 0;

  public override available(): boolean {
    return true;
  }

  public urls?: { updateUrl: string; statsUrl: string; channelUrl: string };

  public override async configure(urls: {
    updateUrl: string;
    statsUrl: string;
    channelUrl: string;
  }): Promise<void> {
    this.urls = urls;
  }

  public override async notifyAppReady(): Promise<void> {
    this.acknowledged++;
    const current = this.bundles.get(this.currentId);
    if (current) {
      current.status = "success";
    }
  }

  public override async current(): Promise<OtaBundle> {
    return this.bundles.get(this.currentId) ?? this.builtin();
  }

  public override async list(): Promise<OtaBundle[]> {
    return [...this.bundles.values()];
  }

  public override async next(): Promise<OtaBundle | undefined> {
    if (!this.nextId) {
      return undefined;
    }
    return this.nextId === "builtin"
      ? this.builtin()
      : this.bundles.get(this.nextId);
  }

  public override async failed(): Promise<OtaBundle | undefined> {
    const failed = this.failedBundle;
    this.failedBundle = undefined;
    return failed;
  }

  public override async check(): Promise<OtaLatest> {
    this.checks++;
    const answer = this.answers.shift() ?? {
      status: 200,
      body: {
        error: "no_new_version_available",
        message: "No new version available",
        kind: "up_to_date",
      },
    };
    if (answer instanceof Error) {
      return {
        error: "response_error",
        message: answer.message,
        kind: "failed",
        statusCode: 0,
      };
    }
    const body = answer.body;
    return {
      version: body.version as string | undefined,
      url: body.url as string | undefined,
      sessionKey: body.session_key as string | undefined,
      checksum: body.checksum as string | undefined,
      error: body.error as string | undefined,
      kind:
        (body.kind as string | undefined) ??
        (answer.status >= 400 ? "failed" : undefined),
      message: body.message as string | undefined,
      statusCode: answer.status,
    };
  }

  public override async download(options: {
    url: string;
    version: string;
    sessionKey: string;
    checksum: string;
  }): Promise<OtaBundle> {
    this.downloads.push(options.url);
    if (!options.sessionKey) {
      throw new AlephaError("Session key required when public key is present");
    }
    if (!options.checksum) {
      throw new AlephaError("Checksum required");
    }
    if (this.broken.has(options.url)) {
      throw new AlephaError(`Failed to download from: ${options.url}`);
    }
    const bundle: OtaBundle = {
      id: `b${++this.counter}`,
      version: options.version,
      status: "pending",
    };
    this.bundles.set(bundle.id, bundle);
    return bundle;
  }

  public override async setNext(id: string): Promise<void> {
    if (id !== "builtin" && !this.bundles.has(id)) {
      throw new AlephaError(
        `Set next version failed. id ${id} does not exist.`,
      );
    }
    if (id === this.currentId && (await this.current()).status === "success") {
      return;
    }
    this.nextId = id;
  }

  public override async markFailed(id: string): Promise<void> {
    const bundle = this.bundles.get(id);
    if (!bundle) {
      throw new AlephaError(`Bundle ${id} does not exist`);
    }
    bundle.status = "error";
  }

  public override async delete(id: string): Promise<void> {
    if (id === this.currentId) {
      throw new AlephaError("Cannot delete the current bundle");
    }
    if (id === this.nextId && this.bundles.get(id)?.status !== "error") {
      throw new AlephaError("Cannot delete the next bundle");
    }
    this.bundles.delete(id);
  }

  public override async setChannel(
    channel: string,
  ): Promise<{ ok: boolean; error?: string }> {
    this.channelRequests.push(channel);
    return channel === "beta"
      ? { ok: true }
      : { ok: false, error: "channel_self_set_not_allowed" };
  }

  /**
   * The app went to the background: the next bundle, unless failed, becomes
   * current, waiting to be acknowledged.
   */
  public background(): void {
    const next = this.nextId;
    this.nextId = undefined;
    if (!next) {
      return;
    }
    if (next === "builtin") {
      this.currentId = "builtin";
      return;
    }
    const bundle = this.bundles.get(next);
    if (bundle && bundle.status !== "error") {
      this.currentId = next;
    }
  }

  /**
   * The readiness window passed with no acknowledgment: back to the last
   * successful bundle, or the built-in layer, and remember the failure.
   */
  public rollBack(): void {
    const failed = this.bundles.get(this.currentId);
    if (!failed) {
      return;
    }
    failed.status = "error";
    this.failedBundle = { ...failed };
    const good = [...this.bundles.values()].find(
      (it) => it.id !== failed.id && it.status === "success",
    );
    this.currentId = good?.id ?? "builtin";
    this.bundles.delete(failed.id);
  }

  protected builtin(): OtaBundle {
    return { id: "builtin", version: this.builtinVersion, status: "success" };
  }
}
