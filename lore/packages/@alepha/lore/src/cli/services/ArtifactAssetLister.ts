import { $inject } from "alepha";
import { AssetWalker } from "alepha/cli";
import { CloudflareAssetManifest } from "alepha/cli/infra-lib";
import { FileSystemProvider } from "alepha/system";

/**
 * The asset list a push carries beside its archive (#Q3381).
 *
 * ## Why the pusher computes it
 *
 * A deploy needs, for every file under `dist/public`, its digest, size and
 * content type: that is what a Workers upload session is negotiated with. It
 * depends only on the build's bytes, so it is computed where they already sit
 * on disk and crypto is native, once per push, instead of once per deploy
 * inside Lore's Worker, which had to inflate and hash the whole archive to
 * learn it. For a site of thousands of files that was most of a deploy's CPU.
 *
 * ## What it is, and is not
 *
 * - **The same files `alepha pack` puts in the archive**: the walk goes
 *   through `AssetWalker`, with pack's excludes, so the list and the archive
 *   never disagree on which files exist.
 * - **The same digest a laptop deploy computes**: `CloudflareAssetManifest`,
 *   the full SHA-256 of the raw bytes.
 * - **`_headers` and `_redirects` travel as texts**, not as assets: Cloudflare
 *   reads them as configuration, and uploaded as files they are published
 *   and applied by nothing.
 * - **A claim, not a fact.** Lore checks every body it uploads against the
 *   digest listed here, and a list that lies only breaks the pusher's own
 *   app. An archive pushed without one still deploys: the Worker then
 *   computes the list itself.
 */
export class ArtifactAssetLister {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly walker = $inject(AssetWalker);
  protected readonly manifest = $inject(CloudflareAssetManifest);

  /**
   * The list for the build under `<root>/dist`, or `undefined` when the build
   * has no `public/`, which is a build with no assets rather than an error.
   */
  public async list(root: string): Promise<ArtifactAssetList | undefined> {
    const publicDir = this.fs.join(root, "dist", "public");
    if (!(await this.fs.exists(publicDir))) {
      return undefined;
    }
    const assets: ArtifactAssetList["assets"] = [];
    const config: ArtifactAssetList["config"] = {};
    for (const relative of await this.walker.walk(publicDir)) {
      const bytes = new Uint8Array(
        await this.fs.readFile(this.fs.join(publicDir, relative)),
      );
      const path = this.manifest.key(relative);
      if (this.manifest.isConfigFile(path)) {
        const field = this.manifest.configField(path);
        if (field) {
          config[field] = new TextDecoder().decode(bytes);
        }
        continue;
      }
      assets.push({
        path,
        sha256: await this.manifest.digest(bytes),
        size: bytes.length,
        contentType: this.manifest.contentType(path),
      });
    }
    return { version: 1, assets, config };
  }
}

/**
 * The asset list as it travels: the `assets` part of a push, JSON.
 *
 * ⚠️ **A wire contract with Lore's push endpoint**, which validates it with its
 * own schema (`artifactAssetListSchema` in `@lore/ship`). An older Lore
 * ignores the part, and an older CLI sends none: both still push.
 */
export interface ArtifactAssetList {
  version: 1;
  /**
   * Every asset, keyed by its served path (`/assets/app.js`).
   */
  assets: Array<{
    path: string;
    /**
     * The full SHA-256 of the raw bytes, 64 lowercase hex characters.
     */
    sha256: string;
    size: number;
    contentType: string;
  }>;
  /**
   * The texts of `public/_headers` and `public/_redirects`, when the build
   * has them.
   */
  config: { _headers?: string; _redirects?: string };
}
