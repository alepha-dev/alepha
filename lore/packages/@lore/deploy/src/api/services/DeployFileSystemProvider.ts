import type { FileLike } from "alepha";
import { MemoryFileSystemProvider, type WriteFileOptions } from "alepha/system";

/**
 * The in-memory filesystem one deploy unpacks its artifact into, with paths
 * that can be pinned against being written over.
 *
 * ## ⚠️ Why a prebuilt artifact's Worker entry is pinned
 *
 * `InfraOrchestrator.up({ prebuilt: true })` still runs the build task, to
 * regenerate `wrangler.jsonc` with the names, bindings and domain only a
 * deploy knows. That same task rewrites `main.cloudflare.js`, and it does so
 * with LORE's vendored framework, while the bundle the entry imports was built
 * with the APP's. When the two disagree the Worker breaks at runtime: the first
 * Lore deploy of alepha.dev got an entry emitting `web:request`, which the
 * app's newer framework refuses as a retired hook name, so every dynamic
 * request threw (Cloudflare 1101, #Q2677).
 *
 * The entry belongs to the bundle it was built with, so an artifact that ships
 * one keeps it; `wrangler.jsonc` is still regenerated. A write to a pinned path
 * is dropped, not refused: the build task has no way to skip that one file,
 * and failing the deploy over a write whose result is not wanted would be
 * worse than ignoring it.
 */
export class DeployFileSystemProvider extends MemoryFileSystemProvider {
  protected readonly pinned = new Set<string>();

  /**
   * Keep `path` as it is now: later writes to it are dropped.
   */
  public pin(path: string): void {
    this.pinned.add(this.normalizePath(path));
  }

  /**
   * Whether a write to `path` would be dropped.
   */
  public isPinned(path: string): boolean {
    return this.pinned.has(this.normalizePath(path));
  }

  public override async writeFile(
    path: string,
    data: Uint8Array | Buffer | string | FileLike,
    options?: WriteFileOptions,
  ): Promise<void> {
    if (this.isPinned(path)) {
      return;
    }
    await super.writeFile(path, data, options);
  }
}
