/**
 * ⚠️ **SAMPLE DATA. There is no artifact registry yet.**
 *
 * The Artifacts tab is designed and built; the endpoint behind it is not. So
 * this module stands in for the client, and every surface that reads it says
 * "sample" out loud - the tab's header chip, its footnote, and the Artifacts
 * KPI on Overview. Nothing here is fetched, stored or downloadable.
 *
 * ## Why a fixture rather than an empty tab
 *
 * An empty state is one screen. What the tab has to get right is the table:
 * which columns an operator reads, in what order, and which of them is the
 * string they actually copy. That is only reviewable against rows.
 *
 * ## The join
 *
 * `releases.tag` is documented as "the future join key to `artifacts.tag`",
 * so the whole tab is `artifacts.tag = releases.tag` and every filename below
 * carries the release's own tag. That is not decoration: it is the reason the
 * tag is kept separate from the title, and the reason retagging a release
 * orphans its builds.
 *
 * ## Swapping in the real thing
 *
 * Replace {@link releaseArtifactsPreview} with a call to the artifact client
 * and delete this file. {@link ReleaseArtifact} is the shape the tab renders
 * and should become the resource schema's type. The tab also drops its
 * `Upload` button and its per-row `Download` on purpose - a control with no
 * endpoint behind it is worse than no control - so both come back with the
 * endpoint, not before it.
 */

/**
 * One built artifact in the registry.
 *
 * **No status field, and there will not be one.** A registry row exists or it
 * does not. Ready / building / failed chips would be modelling a build
 * pipeline, which is a different thing that lives somewhere else.
 */
export interface ReleaseArtifact {
  /**
   * The app the artifact was built from. The first axis of the filename.
   */
  app: string;
  /**
   * The runtime it was built for. The second axis of the filename.
   */
  target: "node" | "cloudflare";
  /**
   * `{app}_{version}_{target}.tar.gz`, where `{version}` is the release tag.
   *
   * Stored whole rather than rebuilt from the three fields beside it,
   * because this is the string an operator pastes into a deploy command or
   * greps a bucket for. A reconstruction is a guess about a naming scheme
   * the registry owns.
   */
  file: string;
  digest: string;
  bytes: number;
  uploadedAt: string;
}

/**
 * Three rows against the given tag, ordered so an app's targets sit together.
 *
 * Deterministic, and deliberately named `my-app` / `my-docs`: a reader whose
 * project has no such app can tell at a glance that these are illustrative.
 * Plausible names taken from the project's own enrolled apps would read as
 * builds that actually happened.
 *
 * `uploadedAt` is offset from a timestamp the caller passes rather than read
 * from a clock, so the tab renders the same thing on the server and in the
 * browser and nothing here has to reach for `Date.now()`.
 */
export const releaseArtifactsPreview = (
  tag: string,
  since: string,
): ReleaseArtifact[] => {
  const at = (minutes: number) =>
    new Date(new Date(since).getTime() - minutes * 60_000).toISOString();

  return [
    {
      app: "my-app",
      target: "node",
      file: `my-app_${tag}_node.tar.gz`,
      digest: "sha256:4f1a9c2be07d5c1c8b0a6f3d9e2417ab",
      bytes: 44_150_000,
      uploadedAt: at(126),
    },
    {
      app: "my-app",
      target: "cloudflare",
      file: `my-app_${tag}_cloudflare.tar.gz`,
      digest: "sha256:9b3e77d10ca4bb61f0d5a7e8c3129f04",
      bytes: 8_808_000,
      uploadedAt: at(124),
    },
    {
      app: "my-docs",
      target: "cloudflare",
      file: `my-docs_${tag}_cloudflare.tar.gz`,
      digest: "sha256:1c88ba3f95e6d2704a19bce5f8032d67",
      bytes: 3_355_000,
      uploadedAt: at(118),
    },
  ];
};
