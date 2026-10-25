import { $inject, AlephaError } from "alepha";
import { BuildPipeline, PackageManagerUtils } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import { CapacitorPackages } from "./CapacitorPackages.ts";
import { CapacitorProject } from "./CapacitorProject.ts";
import { NativeGuard } from "./NativeGuard.ts";

/**
 * `alepha capacitor sync`: build the app shell and copy it into the native
 * projects.
 *
 * The shell is a lean static build of the app (`BuildPipeline` with
 * `shell: true`) into `dist-capacitor/`, so the server's `dist/` is never
 * touched and no page loader runs at build time. The public configuration
 * travels in the `__ALEPHA_CAPACITOR__` define. `cap sync` then copies it,
 * with `capacitor.config.json` and the plugin list, into each native project.
 *
 * Sync is also the recovery from an interrupted `alepha capacitor dev`: it
 * rewrites the copied configs that run left pointing at a server. The guard
 * therefore only reports residue before a sync, and refuses after it, when
 * whatever is left lives in files sync does not own.
 *
 * ⚠️ A sync changes the projects, not the phone. An app already installed
 * keeps the web layer it was built with until it is rebuilt and reinstalled
 * (`alepha capacitor build`).
 */
export class CapacitorSync {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly pipeline = $inject(BuildPipeline);
  protected readonly project = $inject(CapacitorProject);
  protected readonly packages = $inject(CapacitorPackages);
  protected readonly guard = $inject(NativeGuard);

  public async run(opts: {
    root: string;
    run: RunnerMethod;
    /**
     * Build the shell and stop: no native project is read or written. What a
     * browser suite serves, and what a machine without the native toolchains
     * can still produce.
     */
    webOnly?: boolean;
    /**
     * The platforms to sync, all the existing ones by default.
     */
    platforms?: CapacitorPlatform[];
  }): Promise<void> {
    const { root, run } = opts;
    const options = this.project.options();

    const apiUrl = this.project.resolveApiUrl(options);
    if (!apiUrl) {
      throw new AlephaError(
        "A bundled app shell needs the origin of its API. Set capacitor({ apiUrl }) in alepha.config.ts, or PUBLIC_URL.",
      );
    }

    const platforms = opts.webOnly
      ? []
      : await this.existingPlatforms(
          root,
          opts.platforms ?? this.project.platforms(options),
        );

    const residue = await this.guard.inspect(root, platforms);
    if (residue.length > 0) {
      this.log.warn(
        `Development settings found, rewriting what sync owns:\n${residue.map((finding) => `- ${finding}`).join("\n")}`,
      );
    }

    await this.project.writeConfig(root, options);

    const publicConfig = this.project.publicConfig(options, "bundled", apiUrl);
    await this.pipeline.build({
      root,
      run,
      shell: true,
      shellViewport: CapacitorProject.SHELL_VIEWPORT,
      output: { dist: this.project.distDir() },
      define: this.project.defineFor(publicConfig),
    });

    if (platforms.length === 0) {
      return;
    }

    const pm = await this.pm.getPackageManager(root);
    for (const platform of platforms) {
      await run(this.packages.cap(pm, `sync ${platform}`), {
        alias: `cap sync ${platform}`,
        root,
      });
    }

    await this.guard.assertClean(root, platforms, "after sync");

    this.log.info(
      "An app already installed on a device keeps its previous web layer until it is rebuilt and reinstalled: alepha capacitor build <platform>.",
    );
  }

  /**
   * The declared platforms whose native project exists. A missing one is not
   * an error here: `init` creates it.
   */
  protected async existingPlatforms(
    root: string,
    platforms: CapacitorPlatform[],
  ): Promise<CapacitorPlatform[]> {
    const existing: CapacitorPlatform[] = [];
    for (const platform of platforms) {
      if (await this.fs.exists(this.project.platformDir(root, platform))) {
        existing.push(platform);
      } else {
        this.log.warn(
          `No ${platform}/ project: run alepha capacitor init to create it.`,
        );
      }
    }
    return existing;
  }
}
