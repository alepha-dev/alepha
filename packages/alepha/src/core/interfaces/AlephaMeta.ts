/**
 * What this build is, resolved once at build time and baked into the bundle.
 *
 * Read it as {@link Alepha.meta}. The same record is baked into the server and
 * the client bundle from one resolution, so a browser and its server always
 * agree about what is deployed.
 *
 * Two fields are optional, and each absence is a fact rather than a hole.
 */
export interface AlephaMeta {
  /**
   * The application's name, as the deploy knows it.
   *
   * The same slug the build manifest records as `project` and the Cloudflare
   * adapter uses for the worker name, so an operator comparing `/version` to a
   * deploy target is comparing the same string.
   */
  name: string;

  /**
   * The git tag on the built commit, or `"latest"` when there is none.
   *
   * `"latest"` is the honest answer for a continuously deployed app: tags are
   * created per release, so most deploys are genuinely not a tagged version.
   * {@link commit} is what identifies those builds. An app that would rather
   * publish a number of its own overrides this from `alepha.config.ts`.
   *
   * Deliberately never falls back to the app's `package.json` version: one
   * that disagrees with the commit actually deployed is worse than `"latest"`.
   */
  version: string;

  /**
   * Short commit SHA of the built tree.
   *
   * Absent when the build had no git at all, which is the normal case for a
   * docker or tarball build. Survives a shallow CI clone, since resolving it
   * needs no tags, so it is usually present even when {@link version} is
   * `"latest"`.
   */
  commit?: string;

  build: {
    /**
     * When the build ran, ISO 8601.
     *
     * ⚠️ Absent means **no build produced this code**: a vitest run, a `tsx`
     * script, or `alepha` imported by a library consumer outside any Vite
     * build. A placeholder here would be indistinguishable from a real build,
     * so there is none.
     */
    date?: string;

    /**
     * What the SERVER bundle was built to run on.
     *
     * The client bundle carries this same value rather than `"browser"`, on
     * purpose: one record is baked from one resolution, and a footer naming
     * the server's runtime is the useful thing to show. `alepha.isBrowser()`
     * already answers whether the reader is in a browser.
     */
    runtime: "node" | "bun" | "workerd" | "static";

    /**
     * True when this record came from `alepha dev` rather than `alepha build`.
     *
     * Without it, {@link date} in dev is the dev-server's start time and reads
     * as a build that never happened. Also true in the no-build fallback.
     */
    dev: boolean;
  };

  /**
   * The version of Alepha itself that built this.
   *
   * Baked at build time rather than read from `alepha/package.json` at
   * runtime, which is not resolvable on every target.
   */
  framework: string;
}
