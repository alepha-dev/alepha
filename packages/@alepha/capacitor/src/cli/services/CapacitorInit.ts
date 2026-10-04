import { $inject, AlephaError } from "alepha";
import { PackageManagerUtils } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type {
  CapacitorOptions,
  CapacitorPlatform,
} from "../atoms/capacitorOptions.ts";
import { CapacitorPackages } from "./CapacitorPackages.ts";
import { CapacitorProject } from "./CapacitorProject.ts";
import { NativeSchemes } from "./NativeSchemes.ts";

/**
 * `alepha capacitor init`: give an Alepha app its native projects.
 *
 * Idempotent and non-destructive. Every step checks before it writes, so a
 * second run on an unchanged project writes nothing:
 *
 * 1. refuse, before anything is touched, a platform this machine cannot build
 *    (iOS needs macOS) or a project with no `package.json`;
 * 2. install the pinned Capacitor packages that are missing;
 * 3. write `capacitor.config.ts` from `alepha.config.ts`, or leave it alone
 *    when it already says the same thing (one without the generated marker
 *    is the user's, and is refused rather than overwritten);
 * 4. add the ignore rules for build outputs and signing keys;
 * 5. run `cap add` for each platform whose project does not exist yet;
 * 6. register the custom URL scheme in each native project.
 *
 * The native projects are source, checked in like any other: only their
 * build outputs are ignored. Icons and the splash come from the generator of
 * `@alepha/capacitor/cli` once an `icon` is configured; until then
 * Capacitor's default icon stays.
 */
export class CapacitorInit {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly project = $inject(CapacitorProject);
  protected readonly packages = $inject(CapacitorPackages);
  protected readonly schemes = $inject(NativeSchemes);

  /**
   * What the app's `.gitignore` must carry. The native templates ignore their
   * own build products (`ios/.gitignore`, `android/.gitignore`); these are the
   * ones outside them.
   */
  protected readonly ignoreRules = [
    `/${CapacitorProject.DIST_DIR}`,
    "*.keystore",
    "*.jks",
    "*.p12",
    "*.mobileprovision",
  ];

  public async run(opts: {
    root: string;
    run: RunnerMethod;
    platforms?: CapacitorPlatform[];
  }): Promise<void> {
    const { root, run } = opts;
    const options = this.project.options();
    const platforms = opts.platforms ?? this.project.platforms(options);

    await this.checkPrerequisites(root, platforms);

    await this.installPackages(root, run);

    await run({
      name: "write capacitor.config.ts",
      handler: async () => {
        await this.project.writeConfig(root, options);
        await this.ensureWebDir(root);
        await this.ensureIgnoreRules(root);
        await this.ensureFormatterIgnores(root);
      },
    });

    const pm = await this.pm.getPackageManager(root);
    for (const platform of platforms) {
      if (await this.fs.exists(this.project.platformDir(root, platform))) {
        this.log.debug(`${platform}/ exists, not adding it again`);
        continue;
      }
      // SPM for iOS, Capacitor 8's default, named so a CLI default changing
      // under us cannot silently produce a CocoaPods project.
      const args =
        platform === "ios" ? "add ios --packagemanager SPM" : "add android";
      await run(this.packages.cap(pm, args), {
        alias: `cap add ${platform}`,
        root,
      });
    }

    await run({
      name: "register the URL scheme",
      handler: async () => {
        await this.registerScheme(root, options, platforms);
      },
    });
  }

  /**
   * Refuse, before any write, what would leave a half-made project.
   */
  protected async checkPrerequisites(
    root: string,
    platforms: CapacitorPlatform[],
  ): Promise<void> {
    if (!(await this.fs.exists(this.fs.join(root, "package.json")))) {
      throw new AlephaError(
        `No package.json in ${root}. Run alepha capacitor init from the app's root.`,
      );
    }

    // The one file init would overwrite: refused here, not halfway through.
    const configPath = this.project.configPath(root);
    if (await this.fs.exists(configPath)) {
      this.project.assertOwned(await this.fs.readTextFile(configPath));
    }

    if (
      platforms.includes("ios") &&
      this.hostPlatform() !== "darwin" &&
      !(await this.fs.exists(this.project.platformDir(root, "ios")))
    ) {
      throw new AlephaError(
        'An iOS project needs macOS and Xcode to create and build. Run init on a Mac, or declare platforms: ["android"] in capacitor({ ... }).',
      );
    }
  }

  /**
   * The operating system this command runs on. A method so a spec can
   * answer for another host.
   */
  protected hostPlatform(): NodeJS.Platform {
    return process.platform;
  }

  protected async installPackages(
    root: string,
    run: RunnerMethod,
  ): Promise<void> {
    const missing = async (set: Record<string, string>) => {
      const names: string[] = [];
      for (const [name, version] of Object.entries(set)) {
        if (!(await this.pm.hasDependency(root, name))) {
          names.push(`${name}@${version}`);
        }
      }
      return names;
    };

    const runtime = await missing(this.packages.dependencies);
    if (runtime.length > 0) {
      await run(
        await this.pm.getInstallCommand(root, runtime.join(" "), false),
        {
          alias: "install Capacitor",
          root,
        },
      );
    }

    const dev = await missing(this.packages.devDependencies);
    if (dev.length > 0) {
      await run(await this.pm.getInstallCommand(root, dev.join(" "), true), {
        alias: "install the Capacitor CLI",
        root,
      });
    }
  }

  /**
   * `cap add` copies the web directory into the native project and refuses
   * when it is missing. Before the first `alepha capacitor sync` there is no
   * shell yet, so a placeholder stands in; the directory is ignored.
   */
  protected async ensureWebDir(root: string): Promise<void> {
    const index = this.fs.join(root, CapacitorProject.WEB_DIR, "index.html");
    if (await this.fs.exists(index)) {
      return;
    }
    await this.fs.mkdir(this.fs.join(root, CapacitorProject.WEB_DIR), {
      recursive: true,
    });
    await this.fs.writeFile(
      index,
      "<!DOCTYPE html>\n<html><body>Run alepha capacitor sync to build the app shell.</body></html>\n",
    );
  }

  protected async ensureIgnoreRules(root: string): Promise<void> {
    const path = this.fs.join(root, ".gitignore");
    const current = (await this.fs.exists(path))
      ? await this.fs.readTextFile(path)
      : "";
    const lines = new Set(current.split("\n").map((line) => line.trim()));
    const missing = this.ignoreRules.filter((rule) => !lines.has(rule));
    if (missing.length === 0) {
      return;
    }

    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    const header = "# @alepha/capacitor: the app shell and signing keys";
    await this.fs.writeFile(
      path,
      `${current}${prefix}${current ? "\n" : ""}${header}\n${missing.join("\n")}\n`,
    );
  }

  /**
   * Keep the formatter out of the native projects. oxfmt formats JSON, and the
   * asset catalogs of `ios/` are JSON written by Xcode: a format pass would
   * turn every `yarn lint` into a diff of files nobody edited. Only an app
   * with its own `.oxfmtrc.json` (what `alepha init` writes) is touched; a
   * workspace package inherits its repository's.
   */
  protected async ensureFormatterIgnores(root: string): Promise<void> {
    const path = this.fs.join(root, ".oxfmtrc.json");
    if (!(await this.fs.exists(path))) {
      return;
    }
    const config = JSON.parse(await this.fs.readTextFile(path)) as {
      ignorePatterns?: string[];
    };
    const patterns = config.ignorePatterns ?? [];
    const missing = ["ios", "android"].filter((dir) => !patterns.includes(dir));
    if (missing.length === 0) {
      return;
    }
    config.ignorePatterns = [...patterns, ...missing];
    await this.fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  }

  protected async registerScheme(
    root: string,
    options: CapacitorOptions,
    platforms: CapacitorPlatform[],
  ): Promise<void> {
    if (platforms.includes("ios")) {
      const path = this.project.infoPlistPath(root);
      if (await this.fs.exists(path)) {
        const next = this.schemes.registerIos(
          await this.fs.readTextFile(path),
          options.scheme,
          options.appId,
        );
        if (next !== null) {
          await this.fs.writeFile(path, next);
        }
      }
    }

    if (platforms.includes("android")) {
      const path = this.project.androidManifestPath(root);
      if (await this.fs.exists(path)) {
        const next = this.schemes.registerAndroid(
          await this.fs.readTextFile(path),
          options.scheme,
        );
        if (next !== null) {
          await this.fs.writeFile(path, next);
        }
      }
    }
  }
}
