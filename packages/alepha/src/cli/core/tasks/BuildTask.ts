import type { Alepha, AlephaMeta } from "alepha";
import type { RunnerMethod } from "alepha/command";

import type { BuildOptions } from "../atoms/buildOptions.ts";
import type { AppEntry } from "../providers/AppEntryProvider.ts";
import type { BuildManifest } from "../schemas/buildManifest.ts";

export interface BuildTaskContext {
  /**
   * The user's app Alepha container (NOT the CLI container).
   * Used for metadata extraction (pages, primitives, store, etc.).
   */
  alepha: Alepha;

  /**
   * Resolved build options (flags merged with atom defaults).
   * BuildCommand mutates the atom before creating the context,
   * so stats, target, runtime are all resolved values.
   */
  options: BuildOptions;

  /**
   * CLI runner for progress logging.
   * Tasks call this when they have work to show.
   * Tasks decide IF and WHEN to call run — e.g. skip entirely if nothing to do.
   */
  run: RunnerMethod;

  /**
   * Project root directory.
   */
  root: string;

  /**
   * Application entry points resolved by AppEntryProvider.
   */
  entry: AppEntry;

  /**
   * Whether the app has a client-side bundle (React).
   */
  hasClient: boolean;

  /**
   * What this build is: version, commit, date, runtime.
   *
   * Resolved ONCE, here, and handed to every task that bakes it. The server
   * bundle and the client bundle must carry the identical record - two
   * resolutions could disagree about the build date alone, and a browser
   * reporting a different build from its own server is worse than reporting
   * none.
   *
   * Absent in prebuilt mode and on the deploy-side config paths, where no
   * bundle is produced: there is no build to describe, and the bundle tasks
   * that would bake it return early anyway.
   */
  meta?: AlephaMeta;

  /**
   * Build-time snapshot of primitive data, read from
   * `dist/manifest.json`. Populated only in `--prebuilt` mode when a
   * previous build's manifest is present — lets BuildCloudflareTask
   * regenerate `wrangler.jsonc` without re-booting the workspace.
   * `null` when introspection (`ctx.alepha`) is the source of truth.
   */
  manifest: BuildManifest | null;

  /**
   * Resolved `platform({ default, environments, ... })` options from
   * the workspace's `alepha.config.ts`. Populated by `BuildCommand`
   * from the CLI's Alepha instance (where alepha.config.ts ran) —
   * BuildCloudflareTask uses these to write the corresponding fields
   * into `dist/manifest.json` so the deploy side doesn't need to
   * re-load `alepha.config.ts`. `null` when no platform options were
   * declared.
   */
  platformOptions: {
    default?: string;
    environments?: Record<
      string,
      {
        adapter: "cloudflare" | "bay";
        domain?: string;
        zone?: string;
        jurisdiction?: "eu" | "fedramp";
        accountId?: string;
      }
    >;
  } | null;

  flags?: {
    image?: boolean | string;
    /**
     * Skip the slow build steps (Vite client + Vite server + asset
     * compression). Only runs the deploy-config generation
     * (wrangler.jsonc, etc.) — useful when the caller already has a
     * built `dist/` and just needs the wrangler config refreshed for
     * per-deploy overrides.
     */
    prebuilt?: boolean;
  };
}

/**
 * Abstract base class for build pipeline tasks.
 *
 * Each task encapsulates a step in the build pipeline.
 * Tasks control their own progress reporting via ctx.run.
 */
export abstract class BuildTask {
  abstract run(ctx: BuildTaskContext): Promise<void>;
}
