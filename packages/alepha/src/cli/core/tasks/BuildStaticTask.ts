import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Generate a static site output.
 *
 * Ensures index.html, 200.html, and 404.html exist in the client directory,
 * then removes all server artifacts from dist, keeping only the public directory.
 */
export class BuildStaticTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.options.target !== "static") {
      return;
    }

    // `--prebuilt` deploys have no live container to introspect
    // (`ctx.alepha` is null in manifest mode), and this target needs one.
    // Without the guard the build died on a TypeError naming nothing.
    if (ctx.flags?.prebuilt) {
      throw new AlephaError(
        "Target 'static' does not support --prebuilt: it needs a live app to render its pages. Run the build without --prebuilt.",
      );
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const clientDir = ctx.options.output?.public ?? "public";
    const publicDir = this.fs.join(ctx.root, distDir, clientDir);

    await ctx.run({
      name: "generate static site",
      handler: async () => {
        if (!ctx.alepha.isConfigured()) {
          await ctx.alepha.events.emit("configure", ctx.alepha);
        }

        const indexPath = this.fs.join(publicDir, "index.html");
        const isPrerendered = await this.fs.exists(indexPath);
        if (!isPrerendered) {
          await this.renderRootPage(ctx, publicDir);
        }

        const indexHtml = (await this.fs.readFile(indexPath)).toString();
        const shell = this.stripRootContent(indexHtml);

        if (!isPrerendered) {
          await this.fs.writeFile(indexPath, shell);
        }

        const notFoundPath = this.fs.join(publicDir, "404.html");
        if (!(await this.fs.exists(notFoundPath))) {
          await this.fs.writeFile(notFoundPath, shell);
        }

        const spaPath = this.fs.join(publicDir, "200.html");
        if (!(await this.fs.exists(spaPath))) {
          await this.fs.writeFile(spaPath, shell);
        }

        const cnamePath = this.fs.join(publicDir, "CNAME");
        if (!(await this.fs.exists(cnamePath))) {
          const domain =
            ctx.options.static?.domain ?? (await this.generateDomain(ctx.root));
          await this.fs.writeFile(cnamePath, domain);
        }

        await this.cleanDist(this.fs.join(ctx.root, distDir), clientDir);
      },
    });
  }

  protected async renderRootPage(
    ctx: BuildTaskContext,
    publicDir: string,
  ): Promise<void> {
    const pages = ctx.alepha.primitives("page") as any[];
    const rootPage = pages.find(
      (p) => p.options.path === "/" && !p.options.children,
    );

    if (!rootPage) {
      return;
    }

    const { html } = await rootPage.render({ html: true });
    const filepath = this.fs.join(publicDir, "index.html");

    await this.fs.mkdir(dirname(filepath));
    await this.fs.writeFile(filepath, html);
  }

  protected stripRootContent(html: string): string {
    return html.replace(
      /(<body[^>]*>)[\s\S]*?(<\/body>)/,
      '$1<div id="root"></div>$2',
    );
  }

  /**
   * Strip the server side of the build, leaving what a static host serves.
   *
   * `manifest.json` is kept alongside the client directory, and that is not a
   * detail: this task runs AFTER `BuildManifestTask`, so removing everything
   * but `public/` deleted the artifact contract itself. A static build then
   * packed into an archive that every deploy consumer rejects with "read
   * manifest: no such file" — a failure that names the missing file but not the
   * task that removed it.
   */
  protected async cleanDist(distDir: string, clientDir: string): Promise<void> {
    const keep = new Set([clientDir, "manifest.json"]);
    const entries = await this.fs.ls(distDir);
    for (const entry of entries) {
      if (!keep.has(entry)) {
        await this.fs.rm(this.fs.join(distDir, entry), { recursive: true });
      }
    }
  }

  protected async generateDomain(root: string): Promise<string> {
    let name = "app";
    try {
      const content = (
        await this.fs.readFile(this.fs.join(root, "package.json"))
      ).toString();
      const pkg = JSON.parse(content);
      if (pkg.name) {
        name = pkg.name
          .replace(/^@/, "")
          .replace(/\//g, "-")
          .replace(/[^a-z0-9-]/g, "");
      }
    } catch {
      // fallback to "app"
    }

    const hash = createHash("sha256").update(name).digest("hex").slice(0, 6);
    return `${name}-${hash}.surge.sh`;
  }
}
