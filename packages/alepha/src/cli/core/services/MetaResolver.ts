import { basename } from "node:path";

import { $inject, type AlephaMeta } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { ShellProvider } from "alepha/system";

import { version as frameworkVersion } from "../alephaPackageJson.ts";

/**
 * Resolves the {@link AlephaMeta} record that `alepha build` and `alepha dev`
 * bake into the bundles.
 *
 * One resolution feeds every define site, so the server bundle and the client
 * bundle cannot disagree about what is deployed.
 *
 * Everything here runs in the CLI, which is the only place that has both git
 * and a filesystem. The bundle itself never probes anything: by the time the
 * app runs, the answers are already constants.
 */
export class MetaResolver {
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async resolve(options: MetaResolveOptions): Promise<AlephaMeta> {
    const override = options.override ?? {};

    return {
      // An override of `""` is treated as absent throughout. A config that
      // computes its value (`pkg.version` on a package that has none) yields
      // an empty string rather than throwing, and publishing a blank is worse
      // than falling through to what git says.
      name: override.name || this.slug(options.root),
      version: override.version || (await this.gitTag()) || "latest",
      commit: override.commit || (await this.gitCommit()),
      build: {
        date: this.dateTime.nowISOString(),
        runtime: options.runtime,
        dev: options.dev,
      },
      framework: frameworkVersion,
    };
  }

  /**
   * The record as a Vite `define` entry, ready to merge into a build config.
   *
   * ⚠️ Double-encoded, and that is the whole point of this method existing.
   * `define` substitutes its value as raw source text, so a single
   * `JSON.stringify` would emit a bare object literal - fine in the expression
   * position it is read from today, but one refactor away from a parser taking
   * `{...}` for a block. Emitting a string literal instead cannot be reparsed
   * as anything else, and the reader pays one `JSON.parse` per process.
   */
  public define(meta: AlephaMeta): { __ALEPHA_META__: string } {
    return { __ALEPHA_META__: JSON.stringify(JSON.stringify(meta)) };
  }

  /**
   * The app's name as the deploy knows it.
   *
   * Slugified basename of the root, which is what `BuildManifestTask` records
   * as `project` and what the Cloudflare adapter uses for the worker name.
   * Kept identical on purpose: an operator comparing `/version` against a
   * deploy target should be comparing the same string.
   */
  public slug(root: string): string {
    return (
      basename(root)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 63) || "unknown"
    );
  }

  /**
   * The tag on HEAD, or `undefined`.
   *
   * `--points-at` rather than `git describe --exact-match`: it exits 0 with
   * empty output when there is no tag, where describe treats that as an error.
   *
   * ⚠️ Returns nothing under a default `actions/checkout`, which fetches
   * shallow and passes `--no-tags`. A CI job whose artifact is deployed needs
   * `fetch-tags: true`, or every deploy reports `"latest"`.
   *
   * The first line wins when several tags point at the same commit. Arbitrary,
   * but stable, and the alternative (guessing which of them is "the version")
   * is worse than a rule anyone can predict.
   */
  protected async gitTag(): Promise<string | undefined> {
    const out = await this.git("git tag --points-at HEAD");
    const first = out?.split("\n")[0]?.trim();
    if (!first) {
      return undefined;
    }
    // `v0.27.1` and `0.27.1` are the same release named two ways.
    return first.replace(/^v(?=\d)/, "");
  }

  /**
   * Short commit SHA, or `undefined` when there is no git.
   *
   * Deliberately not `"unknown"`: absence is a fact consumers can read, where
   * a placeholder string is one they have to special-case.
   *
   * Unlike {@link gitTag} this survives a shallow clone, since resolving HEAD
   * needs no tags. So even a `"latest"` build says which commit it is.
   */
  protected async gitCommit(): Promise<string | undefined> {
    return (await this.git("git rev-parse --short HEAD")) || undefined;
  }

  /**
   * Run a git command, treating any failure as "no answer".
   *
   * A build outside a repository is completely normal - a tarball install, a
   * docker context that did not copy `.git` - and must not fail the build.
   */
  protected async git(command: string): Promise<string | undefined> {
    try {
      return (await this.shell.run(command, { capture: true })).trim();
    } catch {
      return undefined;
    }
  }
}

export interface MetaResolveOptions {
  /**
   * The workspace root being built.
   */
  root: string;

  /**
   * What the server bundle is being built to run on. `static` for a build with
   * no server at all.
   */
  runtime: AlephaMeta["build"]["runtime"];

  /**
   * True when resolving for `alepha dev` rather than `alepha build`.
   */
  dev: boolean;

  /**
   * Values from the app's `alepha.config.ts` `meta` block, which win over
   * anything resolved here.
   *
   * This is what an app uses when the git tag is not the answer it wants to
   * publish - most often a continuously deployed app, where the tag chain
   * resolves to `"latest"` on every deploy that is not a release.
   */
  override?: Partial<Pick<AlephaMeta, "name" | "version" | "commit">>;
}
