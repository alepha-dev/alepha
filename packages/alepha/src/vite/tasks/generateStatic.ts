import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Alepha } from "alepha";
import {
  compressFile,
  type ViteCompressOptions,
} from "../plugins/viteCompress.ts";

export interface GenerateStaticOptions {
  /**
   * Alepha instance for pre-rendering.
   */
  alepha: Alepha;

  /**
   * The dist directory (e.g., "dist").
   */
  distDir: string;

  /**
   * The client/public subdirectory name (e.g., "public").
   */
  clientDir: string;

  /**
   * Compression options for pre-rendered HTML files.
   */
  compress?: ViteCompressOptions | boolean;

  /**
   * Surge domain for CNAME file.
   *
   * If set, used as-is. If not set, auto-generated from package.json name.
   */
  domain?: string;

  /**
   * Project root directory (for reading package.json).
   */
  root?: string;

  /**
   * Runner for CLI progress logging.
   */
  run?: (opts: {
    name: string;
    handler: () => Promise<void>;
  }) => Promise<string>;
}

/**
 * Generate a static site output.
 *
 * Ensures index.html, 200.html, and 404.html exist in the client directory,
 * then removes all server artifacts from dist, keeping only the public directory.
 */
export async function generateStatic(
  opts: GenerateStaticOptions,
): Promise<void> {
  const { alepha, distDir, clientDir, compress } = opts;
  const publicDir = join(distDir, clientDir);

  const fn = async () => {
    // Ensure configure has run (pages must be registered)
    if (!alepha.isConfigured()) {
      await alepha.events.emit("configure", alepha);
    }

    // Force-render "/" if index.html does not exist yet (not pre-rendered)
    const indexPath = join(publicDir, "index.html");
    const isPrerendered = await exists(indexPath);
    if (!isPrerendered) {
      await renderRootPage(alepha, publicDir, compress);
    }

    // Build an SPA shell from index.html with an empty <div id="root"></div>.
    // Pages pre-rendered via `static: true` already have their own HTML files;
    // the shell is used for index.html (when not pre-rendered), 200.html,
    // and 404.html so the client-side router handles rendering without
    // hydration mismatches.
    const indexHtml = await readFile(indexPath, "utf-8");
    const shell = stripRootContent(indexHtml);

    // If index.html was generated here (not pre-rendered), replace it
    // with the empty shell to avoid hydration mismatches.
    if (!isPrerendered) {
      await writeFile(indexPath, shell);
      if (compress) {
        await compressFile(
          typeof compress === "object" ? compress : {},
          indexPath,
        );
      }
    }

    const notFoundPath = join(publicDir, "404.html");
    if (!(await exists(notFoundPath))) {
      await writeFile(notFoundPath, shell);
      if (compress) {
        await compressFile(
          typeof compress === "object" ? compress : {},
          notFoundPath,
        );
      }
    }

    const spaPath = join(publicDir, "200.html");
    if (!(await exists(spaPath))) {
      await writeFile(spaPath, shell);
      if (compress) {
        await compressFile(
          typeof compress === "object" ? compress : {},
          spaPath,
        );
      }
    }

    // Write CNAME for Surge deployment
    const cnamePath = join(publicDir, "CNAME");
    if (!(await exists(cnamePath))) {
      const domain =
        opts.domain ?? (await generateDomain(opts.root ?? process.cwd()));
      await writeFile(cnamePath, domain);
    }

    // Clean dist/ — remove everything except the public directory
    await cleanDist(distDir, clientDir);
  };

  if (opts.run) {
    await opts.run({ name: "generate static site", handler: fn });
  } else {
    await fn();
  }
}

/**
 * Render the root "/" page and write index.html.
 */
async function renderRootPage(
  alepha: Alepha,
  publicDir: string,
  compress?: ViteCompressOptions | boolean,
): Promise<void> {
  const pages = alepha.primitives("page") as any[];
  const rootPage = pages.find(
    (p) => p.options.path === "/" && !p.options.children,
  );

  if (!rootPage) {
    return;
  }

  const { html } = await rootPage.render({ html: true });
  const filepath = join(publicDir, "index.html");

  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, html);

  if (compress) {
    await compressFile(typeof compress === "object" ? compress : {}, filepath);
  }
}

/**
 * Replace the body content with an empty root div,
 * producing an SPA shell that won't cause hydration mismatches.
 */
function stripRootContent(html: string): string {
  return html.replace(
    /(<body[^>]*>)[\s\S]*?(<\/body>)/,
    '$1<div id="root"></div>$2',
  );
}

/**
 * Remove all entries in distDir except the clientDir.
 */
async function cleanDist(distDir: string, clientDir: string): Promise<void> {
  const entries = await readdir(distDir);

  for (const entry of entries) {
    if (entry !== clientDir) {
      await rm(join(distDir, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Check if a file exists at the given path.
 */
async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

/**
 * Generate a deterministic Surge domain from package.json name.
 *
 * Produces `{name}-{6-char-hash}.surge.sh` where the hash is
 * derived from the package name, so the same project always
 * gets the same domain.
 */
async function generateDomain(root: string): Promise<string> {
  let name = "app";
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
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
