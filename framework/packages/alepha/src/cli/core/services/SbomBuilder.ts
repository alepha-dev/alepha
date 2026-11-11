import { randomUUID } from "node:crypto";
import { dirname, sep } from "node:path";

import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider } from "alepha/system";

import { version as alephaVersion } from "../alephaPackageJson.ts";

/**
 * One package the build bundled, as read from its own `package.json`.
 */
export interface SbomPackage {
  name: string;
  version: string;
  license?: string;
}

/**
 * A CycloneDX component, the subset this builder writes.
 */
export interface SbomComponent {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  licenses?: Array<{ expression: string } | { license: { name: string } }>;
}

/**
 * The CycloneDX JSON document `alepha build` writes into
 * `dist/sbom.cdx.json` when `build.sbom` is on.
 *
 * ## ⚠️ From the bundler's module graph, never from the lockfile
 *
 * An Alepha server build bundles its npm dependencies (`ssr.noExternal`), so
 * nothing in `dist/` and nothing in an image built from it names them: a
 * scanner reading the image finds the base and none of the app. The build is
 * the only step that knows what was bundled, so it records it.
 *
 * A lockfile is the wrong source twice over. It lists dev tools that never
 * ship, and an SBOM naming the test runner produces vulnerability findings
 * about code the artifact does not contain. And the CLI supports four
 * package managers with four lockfile formats.
 *
 * So {@link plugin} is added to the client build and to every server slice:
 * it reads each emitted chunk's module ids, and {@link write} resolves every
 * id to its nearest named `package.json`. The document is the union of all
 * of them, plus the externals `dist/package.json` declares.
 *
 * ## What is left out
 *
 * - The app's own modules: the app is `metadata.component`.
 * - Packages marked `private`: in a monorepo they are the app's own code
 *   (a workspace package), never something a registry served.
 * - Virtual modules (`\0...`), which belong to no package.
 */
export class SbomBuilder {
  /**
   * The name of the SBOM `alepha build` writes at the root of `dist/`, and
   * the one `alepha image` copies into the image.
   */
  public static readonly FILE = "sbom.cdx.json";

  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Every module id the builds of this run emitted.
   */
  protected readonly moduleIds = new Set<string>();

  /**
   * `package.json` lookups by directory: thousands of modules share a few
   * hundred packages.
   */
  protected readonly packageCache = new Map<string, PackageJson | null>();

  /**
   * Forget what an earlier build in the same process collected.
   */
  public reset(): void {
    this.moduleIds.clear();
    this.packageCache.clear();
  }

  /**
   * The Vite plugin that records what a build emitted. `generateBundle`
   * sees the chunks after tree shaking, so a module the bundler dropped is
   * not listed.
   */
  public plugin(): {
    name: string;
    generateBundle: (options: unknown, bundle: Record<string, unknown>) => void;
  } {
    return {
      name: "alepha:sbom",
      generateBundle: (_options, bundle) => {
        for (const output of Object.values(bundle)) {
          const chunk = output as { type?: string; moduleIds?: string[] };
          if (chunk.type !== "chunk") {
            continue;
          }
          for (const id of chunk.moduleIds ?? []) {
            this.moduleIds.add(id);
          }
        }
      },
    };
  }

  /**
   * The module ids collected so far.
   */
  public collected(): string[] {
    return [...this.moduleIds];
  }

  /**
   * Write `dist/sbom.cdx.json`.
   */
  public async write(opts: {
    root: string;
    distDir: string;
    project: string;
    version: string;
  }): Promise<string> {
    const appPackage = await this.findPackage(opts.root);
    const packages = new Map<string, SbomPackage>();

    for (const id of this.moduleIds) {
      const path = this.modulePath(id);
      if (!path) {
        continue;
      }
      const found = await this.findPackage(dirname(path));
      if (!found || found.private || found.dir === appPackage?.dir) {
        continue;
      }
      packages.set(`${found.name}@${found.version}`, {
        name: found.name,
        version: found.version,
        license: found.license,
      });
    }

    for (const external of await this.externals(opts.root, opts.distDir)) {
      packages.set(`${external.name}@${external.version}`, external);
    }

    const document = this.document({
      project: opts.project,
      version: opts.version,
      packages: [...packages.values()],
    });
    const file = this.fs.join(opts.root, opts.distDir, SbomBuilder.FILE);
    await this.fs.writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
    return file;
  }

  /**
   * The CycloneDX 1.6 document, components sorted by purl so two builds of
   * the same graph differ only by their serial number and timestamp.
   */
  public document(opts: {
    project: string;
    version: string;
    packages: SbomPackage[];
  }): Record<string, unknown> {
    const components = opts.packages
      .map((pkg) => this.component(pkg))
      .sort((a, b) => a.purl.localeCompare(b.purl));
    return {
      $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: `urn:uuid:${randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: this.dateTime.nowISOString(),
        tools: {
          components: [
            {
              type: "application",
              name: "alepha",
              version: alephaVersion,
              purl: this.purl("alepha", alephaVersion),
            },
          ],
        },
        component: {
          type: "application",
          "bom-ref": `app:${opts.project}`,
          name: opts.project,
          version: opts.version,
        },
      },
      components,
    };
  }

  /**
   * One package as a CycloneDX component.
   *
   * ⚠️ **A license goes in as an `expression`, never as a `license.id`.** The
   * schema checks an `id` against the SPDX list, and a package declaring
   * `"Apache 2.0"` would make the whole document invalid. An expression is
   * free text to the schema and is what an SPDX value already is. A value
   * that is plainly not SPDX (`SEE LICENSE IN ...`) becomes a `name`.
   */
  public component(pkg: SbomPackage): SbomComponent {
    const purl = this.purl(pkg.name, pkg.version);
    const component: SbomComponent = {
      type: "library",
      "bom-ref": purl,
      name: pkg.name,
      version: pkg.version,
      purl,
    };
    const license = pkg.license?.trim();
    if (license) {
      component.licenses = /\s/.test(
        license.replace(/\s+(OR|AND|WITH)\s+/g, "|"),
      )
        ? [{ license: { name: license } }]
        : [{ expression: license }];
    }
    return component;
  }

  /**
   * `pkg:npm/name@version`, the scope's `@` percent-encoded as the purl
   * specification asks.
   */
  public purl(name: string, version: string): string {
    return `pkg:npm/${name.replace(/^@/, "%40")}@${encodeURIComponent(version)}`;
  }

  /**
   * The file a module id points at, or null for a virtual module.
   */
  protected modulePath(id: string): string | null {
    if (id.startsWith("\0") || !id.startsWith(sep)) {
      return null;
    }
    const clean = id.split("?")[0];
    return clean || null;
  }

  /**
   * The nearest `package.json` above a directory that carries a name and a
   * version. A bare `{ "type": "module" }` inside a package's `dist/` is
   * skipped: it says how to load the files, not what they are.
   */
  protected async findPackage(start: string): Promise<PackageJson | null> {
    const visited: string[] = [];
    let dir = start;
    let found: PackageJson | null = null;
    while (true) {
      if (this.packageCache.has(dir)) {
        found = this.packageCache.get(dir) ?? null;
        break;
      }
      visited.push(dir);
      const file = this.fs.join(dir, "package.json");
      if (await this.fs.exists(file)) {
        try {
          const json =
            await this.fs.readJsonFile<Record<string, unknown>>(file);
          if (
            typeof json.name === "string" &&
            typeof json.version === "string"
          ) {
            found = {
              dir,
              name: json.name,
              version: json.version,
              license: this.licenseOf(json),
              private: json.private === true,
            };
            break;
          }
        } catch {
          // An unreadable file names nothing; keep walking.
        }
      }
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    for (const it of visited) {
      this.packageCache.set(it, found);
    }
    return found;
  }

  /**
   * The SPDX value of `license`, or of the legacy `licenses` array.
   */
  protected licenseOf(json: Record<string, unknown>): string | undefined {
    const license = json.license;
    if (typeof license === "string") {
      return license;
    }
    if (license && typeof license === "object" && "type" in license) {
      return String((license as { type: unknown }).type);
    }
    if (Array.isArray(json.licenses)) {
      const types = json.licenses
        .map((it) => (it as { type?: unknown })?.type)
        .filter((it): it is string => typeof it === "string");
      return types.length ? types.join(" OR ") : undefined;
    }
    return undefined;
  }

  /**
   * The packages `dist/package.json` declares as `dependencies`: left out of
   * the bundle, installed beside it, and shipped all the same. Their version
   * is the installed one when it can be read, the declared range otherwise.
   */
  protected async externals(
    root: string,
    distDir: string,
  ): Promise<SbomPackage[]> {
    let dependencies: Record<string, string> = {};
    try {
      const pkg = await this.fs.readJsonFile<{
        dependencies?: Record<string, string>;
      }>(this.fs.join(root, distDir, "package.json"));
      dependencies = pkg.dependencies ?? {};
    } catch {
      return [];
    }
    const out: SbomPackage[] = [];
    for (const [name, range] of Object.entries(dependencies)) {
      const installed = await this.findPackage(
        this.fs.join(root, "node_modules", name),
      );
      out.push(
        installed?.name === name
          ? {
              name,
              version: installed.version,
              license: installed.license,
            }
          : { name, version: range.replace(/^[\^~]/, "") },
      );
    }
    return out;
  }
}

interface PackageJson {
  dir: string;
  name: string;
  version: string;
  license?: string;
  private: boolean;
}
