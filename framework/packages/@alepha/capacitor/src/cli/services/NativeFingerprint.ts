import { createHash } from "node:crypto";

import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";

/**
 * What a native binary is built from, reduced to one hash.
 *
 * Two binaries with the same fingerprint run the same native code, so a web
 * layer built for one runs on the other. The inputs, canonical and sorted:
 *
 * - the resolved version of `@capacitor/core`, the platform package, and
 *   every installed package Capacitor's own CLI treats as a plugin (a
 *   `capacitor` field in its `package.json`);
 * - the platform's native sources and configuration: on iOS the Xcode
 *   project, SPM's `Package.resolved` and the app's Swift, plists and
 *   storyboards; on Android the Gradle files, the manifest, the Java or
 *   Kotlin sources and `res/xml` and `res/values`;
 * - the identity: app id, name, scheme and variant.
 *
 * Deliberately left out: the root `yarn.lock` (an unrelated web dependency
 * bump would otherwise demand a native rebuild), generated assets (icons,
 * splash, the copied web layer and the config files `cap sync` writes),
 * build products, credentials,
 * and the records file itself.
 */
export class NativeFingerprint {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The native files of one platform that count, relative to the root.
   */
  protected readonly includes: Record<CapacitorPlatform, RegExp[]> = {
    ios: [
      /^ios\/App\/App\.xcodeproj\/project\.pbxproj$/,
      /^ios\/App\/App\.xcodeproj\/project\.xcworkspace\/xcshareddata\/swiftpm\/Package\.resolved$/,
      /^ios\/App\/CapApp-SPM\/Package\.swift$/,
      /^ios\/[^/]+\.xcconfig$/,
      /^ios\/App\/App\/(?!public\/)(?!Assets\.xcassets\/)[^]*\.(swift|m|h|plist|storyboard|entitlements|xcconfig)$/,
    ],
    android: [
      /^android\/[^/]+\.gradle$/,
      /^android\/gradle\.properties$/,
      /^android\/gradle\/wrapper\/gradle-wrapper\.properties$/,
      /^android\/app\/[^/]+\.gradle$/,
      /^android\/app\/proguard-rules\.pro$/,
      /^android\/app\/src\/main\/AndroidManifest\.xml$/,
      /^android\/app\/src\/main\/(java|kotlin)\/.+\.(java|kt)$/,
      // `res/xml/config.xml` is written by `cap sync` (Capacitor's own
      // .gitignore lists it): counted, a fresh checkout's first build and
      // every build after it would disagree with no input changed.
      /^android\/app\/src\/main\/res\/(xml|values)\/(?!config\.xml$)[^/]+\.xml$/,
    ],
  };

  /**
   * Directories never walked: build products and caches.
   */
  protected readonly skip =
    /(^|\/)(build|\.gradle|DerivedData|output|Pods|node_modules|\.idea)(\/|$)/;

  public async compute(opts: {
    root: string;
    platform: CapacitorPlatform;
    identity: Record<string, string>;
  }): Promise<{ fingerprint: string; inputs: Record<string, string> }> {
    const inputs: Record<string, string> = {};

    for (const [key, value] of Object.entries(opts.identity)) {
      inputs[`identity:${key}`] = value;
    }

    for (const [name, version] of Object.entries(
      await this.nativePackages(opts.root, opts.platform),
    )) {
      inputs[`package:${name}`] = version;
    }

    for (const file of await this.nativeFiles(opts.root, opts.platform)) {
      inputs[`file:${file}`] = await this.hashFile(
        this.fs.join(opts.root, file),
      );
    }

    return { fingerprint: this.hashInputs(inputs), inputs };
  }

  /**
   * SHA-256 over the inputs, sorted by key, one `key=value` per line.
   */
  public hashInputs(inputs: Record<string, string>): string {
    const canonical = Object.keys(inputs)
      .sort()
      .map((key) => `${key}=${inputs[key]}`)
      .join("\n");
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * SHA-256 of a file, or of a directory as the sorted list of its files'
   * relative paths and hashes (an iOS `.app` is a directory).
   */
  public async hashArtifact(path: string): Promise<string> {
    const stat = await this.fs.stat(path);
    if (!stat.isDirectory) {
      return this.hashFile(path);
    }
    const entries = (
      await this.fs.ls(path, { recursive: true, hidden: true })
    ).sort();
    const lines: string[] = [];
    for (const entry of entries) {
      const full = this.fs.join(path, entry);
      if (!(await this.fs.stat(full)).isDirectory) {
        lines.push(`${entry}:${await this.hashFile(full)}`);
      }
    }
    return createHash("sha256").update(lines.join("\n")).digest("hex");
  }

  protected async hashFile(path: string): Promise<string> {
    return createHash("sha256")
      .update(await this.fs.readFile(path))
      .digest("hex");
  }

  protected async nativeFiles(
    root: string,
    platform: CapacitorPlatform,
  ): Promise<string[]> {
    const dir = this.fs.join(root, platform);
    if (!(await this.fs.exists(dir))) {
      throw new AlephaError(
        `There is no ${platform}/ project. Run alepha capacitor init first.`,
      );
    }
    const entries = await this.fs.ls(dir, { recursive: true, hidden: true });
    return entries
      .map((entry) => `${platform}/${entry}`)
      .filter((file) => !this.skip.test(file))
      .filter((file) => this.includes[platform].some((re) => re.test(file)))
      .sort();
  }

  /**
   * The version of every native package this platform links, as installed.
   */
  protected async nativePackages(
    root: string,
    platform: CapacitorPlatform,
  ): Promise<Record<string, string>> {
    const pkg = JSON.parse(
      await this.fs.readTextFile(this.fs.join(root, "package.json")),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies });
    const versions: Record<string, string> = {};

    for (const name of names) {
      const installed = await this.readInstalled(root, name);
      if (!installed) {
        continue;
      }
      const isCore =
        name === "@capacitor/core" || name === `@capacitor/${platform}`;
      if (isCore || installed.capacitor !== undefined) {
        versions[name] = String(installed.version);
      }
    }

    for (const name of ["@capacitor/core", `@capacitor/${platform}`]) {
      if (!versions[name]) {
        throw new AlephaError(
          `${name} is not installed. Run alepha capacitor init.`,
        );
      }
    }

    return versions;
  }

  /**
   * A package's installed `package.json`, found the way Node finds it: in
   * the nearest `node_modules` up from the project root.
   */
  protected async readInstalled(
    root: string,
    name: string,
  ): Promise<{ version?: string; capacitor?: unknown } | undefined> {
    let dir = root;
    while (true) {
      const candidate = this.fs.join(dir, "node_modules", name, "package.json");
      if (await this.fs.exists(candidate)) {
        return JSON.parse(await this.fs.readTextFile(candidate));
      }
      const parent = this.fs.join(dir, "..");
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }
}
