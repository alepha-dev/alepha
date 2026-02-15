import type { Alepha } from "alepha";
import type { RunnerMethod } from "alepha/command";
import type { BuildOptions } from "../atoms/buildOptions.ts";
import type { AppEntry } from "../providers/AppEntryProvider.ts";

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
   * Raw CLI flags passed through from the command.
   * Tasks can read flags relevant to their domain.
   */
  flags?: {
    image?: boolean | string;
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
