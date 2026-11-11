import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

import { ViteUtils } from "./ViteUtils.ts";

/**
 * Bundles the server a static site's image runs: `StaticSiteServer` from
 * `alepha/server/static` and nothing of the app, into one file of `dist/`.
 *
 * A static artifact holds no server code (`BuildStaticTask` keeps `public/`
 * and the manifest), so `alepha image` brings its own: bundled, not a full
 * `alepha` install in the image. The app's own `alepha` resolves it, so the
 * server and the build that wrote the files are the same version.
 */
export class StaticImageBundler {
  /**
   * The file the bundle is written to, relative to `dist/`, and what the
   * image's `CMD` runs.
   */
  public static readonly ENTRY = "static-server.mjs";

  protected readonly fs = $inject(FileSystemProvider);
  protected readonly vite = $inject(ViteUtils);

  /**
   * Write `dist/static-server.mjs`: `.mjs`, since a static `dist/` has no
   * `package.json` to say `"type": "module"`.
   */
  public async bundle(root: string, distDir: string): Promise<void> {
    const cacheDir = this.fs.join(root, "node_modules", ".alepha");
    const entry = this.fs.join(cacheDir, "static-server.entry.ts");
    await this.fs.mkdir(cacheDir, { recursive: true });
    await this.fs.writeFile(
      entry,
      [
        'import { Alepha, run } from "alepha";',
        'import { StaticSiteServer } from "alepha/server/static";',
        "",
        "run(Alepha.create().with(StaticSiteServer));",
        "",
      ].join("\n"),
    );

    const { build } = await this.vite.importVite();
    try {
      await build({
        root,
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        ssr: {
          noExternal: true,
          resolve: { conditions: ["node", "module", "import"] },
        },
        build: {
          ssr: entry,
          outDir: this.fs.join(root, distDir),
          emptyOutDir: false,
          // Unminified: the log names its services, and the file is read once.
          minify: false,
          rolldownOptions: {
            external: [/^node:/],
            output: {
              entryFileNames: StaticImageBundler.ENTRY,
              codeSplitting: false,
              format: "esm",
            },
          },
        },
      } as Parameters<typeof build>[0]);
    } finally {
      await this.fs.rm(entry, { force: true });
    }
  }
}
