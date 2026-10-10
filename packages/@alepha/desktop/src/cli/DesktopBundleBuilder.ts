import { fileURLToPath } from "node:url";

import { AlephaError } from "alepha";
import type { FileSystemProvider, ShellProvider } from "alepha/system";

import type { DesktopConfig } from "../core/schemas/desktopConfigSchema.ts";

/**
 * Assembles and signs `<Name>.app` around a compiled desktop executable.
 *
 * ```
 * <Name>.app/Contents/
 *   Info.plist
 *   MacOS/<out>                     the executable, public/ and libwebview inside
 *   Resources/app.icns              the configured PNG converted, or the default
 *   Resources/migrations/           when the project has them, read-only
 *   Resources/THIRD_PARTY_NOTICES.md
 * ```
 *
 * Everything happens in the staging directory it is given, so a failed
 * conversion or signature never leaves a partial app where the build output
 * lives.
 *
 * Signing is ad hoc (`codesign --sign -`), nested code first and the bundle
 * last, then verified strictly; no `--deep`, no entitlements (Q2234 measured
 * none were needed). Ad hoc signing makes a locally built app run on the Mac
 * that built it. It is not a Developer ID signature or a notarization, and a
 * downloaded copy meets Gatekeeper's checks for unidentified developers.
 */
export class DesktopBundleBuilder {
  protected readonly fs: FileSystemProvider;
  protected readonly shell: ShellProvider;

  /**
   * The lowest macOS the app declares: the deployment target of the embedded
   * `libwebview.dylib` (webview-bun 2.4.0, measured in Q2234). Never lower.
   */
  public readonly minimumSystemVersion = "15.0";

  /**
   * The icon sizes of an `.iconset`, each also at @2x.
   */
  public readonly iconSizes = [16, 32, 128, 256, 512];

  constructor(services: { fs: FileSystemProvider; shell: ShellProvider }) {
    this.fs = services.fs;
    this.shell = services.shell;
  }

  /**
   * Build `<stage>/<config.name>.app` around `binary`, sign and verify it, and
   * answer its path.
   */
  public async build(input: {
    root: string;
    stage: string;
    binary: string;
    executable: string;
    config: DesktopConfig;
  }): Promise<string> {
    const { config, executable } = input;
    if (executable.toLowerCase().endsWith(".app") || executable.includes("/")) {
      throw new AlephaError(
        `--out '${executable}' names the executable inside the bundle, not the bundle: drop the '.app'.`,
      );
    }

    const app = this.fs.join(input.stage, `${config.name}.app`);
    const contents = this.fs.join(app, "Contents");
    const resources = this.fs.join(contents, "Resources");
    await this.fs.rm(app, { recursive: true, force: true });
    await this.fs.mkdir(this.fs.join(contents, "MacOS"), { recursive: true });
    await this.fs.mkdir(resources, { recursive: true });

    await this.fs.cp(input.binary, this.fs.join(contents, "MacOS", executable));
    await this.icon(
      input.root,
      input.stage,
      config,
      this.fs.join(resources, "app.icns"),
    );

    const migrations = this.fs.join(input.root, "migrations");
    if (await this.fs.exists(migrations)) {
      await this.fs.cp(migrations, this.fs.join(resources, "migrations"), {
        recursive: true,
      });
    }
    await this.fs.cp(
      this.packageFile("THIRD_PARTY_NOTICES.md"),
      this.fs.join(resources, "THIRD_PARTY_NOTICES.md"),
    );
    await this.fs.writeFile(
      this.fs.join(contents, "Info.plist"),
      this.plist(config, executable, await this.version(input.root)),
    );

    await this.sign(app, this.fs.join(contents, "MacOS", executable));
    return app;
  }

  /**
   * `Info.plist`, every value XML-escaped.
   */
  public plist(
    config: DesktopConfig,
    executable: string,
    version: string,
  ): string {
    const entries: Array<[string, string | boolean]> = [
      ["CFBundleDevelopmentRegion", "en"],
      ["CFBundleDisplayName", config.name],
      ["CFBundleExecutable", executable],
      ["CFBundleIconFile", "app.icns"],
      ["CFBundleIdentifier", config.identifier],
      ["CFBundleInfoDictionaryVersion", "6.0"],
      ["CFBundleName", config.name],
      ["CFBundlePackageType", "APPL"],
      ["CFBundleShortVersionString", version],
      ["CFBundleVersion", version],
      ["LSMinimumSystemVersion", this.minimumSystemVersion],
      ["NSHighResolutionCapable", true],
    ];
    const body = entries
      .map(([key, value]) =>
        typeof value === "boolean"
          ? `  <key>${key}</key>\n  <${value}/>`
          : `  <key>${key}</key>\n  <string>${this.escape(value)}</string>`,
      )
      .join("\n");
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      `<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`
    );
  }

  /**
   * The project's `package.json` version as macOS wants it (up to three
   * dot-separated integers), or `1.0.0`.
   */
  public async version(root: string): Promise<string> {
    try {
      const pkg = await this.fs.readJsonFile<{ version?: string }>(
        this.fs.join(root, "package.json"),
      );
      const match = /^(\d+)(\.\d+)?(\.\d+)?/.exec(pkg.version ?? "");
      if (match) {
        return match[0];
      }
    } catch {}
    return "1.0.0";
  }

  protected async icon(
    root: string,
    stage: string,
    config: DesktopConfig,
    target: string,
  ): Promise<void> {
    if (!config.icon) {
      await this.fs.cp(this.packageFile("assets/app.icns"), target);
      return;
    }
    const png = this.fs.join(root, config.icon);
    const iconset = this.fs.join(stage, "app.iconset");
    await this.fs.rm(iconset, { recursive: true, force: true });
    await this.fs.mkdir(iconset, { recursive: true });
    for (const size of this.iconSizes) {
      for (const scale of [1, 2]) {
        const pixels = String(size * scale);
        const file = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
        await this.shell.run(
          [
            "sips",
            "-z",
            pixels,
            pixels,
            png,
            "--out",
            this.fs.join(iconset, file),
          ],
          { capture: true },
        );
      }
    }
    await this.shell.run(["iconutil", "-c", "icns", iconset, "-o", target], {
      capture: true,
    });
  }

  protected async sign(app: string, executable: string): Promise<void> {
    await this.shell.run(
      ["codesign", "--force", "--sign", "-", "--timestamp=none", executable],
      { capture: true },
    );
    await this.shell.run(
      ["codesign", "--force", "--sign", "-", "--timestamp=none", app],
      { capture: true },
    );
    await this.shell.run(
      ["codesign", "--verify", "--strict", "--verbose=2", app],
      {
        capture: true,
      },
    );
  }

  protected escape(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * A file shipped at the root of this package.
   */
  protected packageFile(path: string): string {
    return fileURLToPath(new URL(`../../${path}`, import.meta.url));
  }
}
