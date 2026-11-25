import {
  type ArtifactDeclares,
  artifactResourceName,
} from "../../../../../api/schemas/artifactDeclaresSchema.ts";
import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";

export type ArtifactCopy = ArtifactDetail["copies"][number];
export type ArtifactRun = ArtifactDetail["deployments"][number];

/**
 * How one copy stands against one variant.
 *
 * - `running`: its newest succeeded run shipped these bytes.
 * - `superseded`: it ran these bytes once and has moved on.
 * - `other`: it never ran them, or has never deployed.
 *
 * ⚠️ Digests, never tags. `latest` is replaced in place, so a copy deployed
 * from `latest` last week reads `latest` and runs older bytes.
 */
export type ArtifactCopyState = "running" | "superseded" | "other";

export interface ArtifactBuildRow {
  tag: string;
  size?: number;
  /**
   * Bytes against the next older build of the same runtime and format. Absent
   * for the oldest, and whenever either side has no size.
   */
  delta?: number;
  pushedAt: string;
  /**
   * The commit this build was made from, when its pusher said.
   */
  commitSha?: string;
  /**
   * What the build declares. Absent is unknown: an image, a build with no
   * stored manifest, or a listing that did not ask.
   */
  declares?: ArtifactDeclares;
  /**
   * What it declares against the next older build of the same runtime and
   * format. Absent for the oldest, and whenever either side is unknown: a
   * build of unknown content has changed nothing anyone can name.
   */
  changes?: ArtifactBuildChanges;
}

/**
 * The names one build has that the one before it lacked, and the reverse.
 */
export interface ArtifactNameChange {
  added: string[];
  removed: string[];
}

export interface ArtifactBuildChanges {
  variables: ArtifactNameChange;
  secrets: ArtifactNameChange;
  resources: ArtifactNameChange;
  crons: ArtifactNameChange;
  /**
   * The runtime slices now carried, only when they differ from the older
   * build's.
   */
  runtimes?: string[];
}

export interface ArtifactManifestSlice {
  runtime: string;
  entry?: string;
  version?: string;
}

/**
 * The parts of `dist/manifest.json` the page draws. The document is `.loose()`
 * and written by a build of any age, so every field is read defensively.
 */
export interface ArtifactManifestSummary {
  slices: ArtifactManifestSlice[];
  /**
   * Every resource the document names, on or off.
   */
  resources: Array<{ name: string; on: boolean }>;
  crons: string[];
  secrets: string[];
  variables: string[];
  websocketPaths: string[];
}

export interface ArtifactImagePlatform {
  platform: string;
  digest?: string;
}

/**
 * The address of one variant in `?variant=`. `(runtime, format)` is the row's
 * key minus what the URL already says.
 */
export const artifactVariantKey = (
  variant: Pick<ArtifactResource, "runtime" | "format">,
): string => `${variant.runtime}-${variant.format}`;

/**
 * Where one build lives. A plain path rather than `router.path`, because a row
 * of it renders on four other pages and each of their specs would otherwise
 * have to declare this route. `test/app-routes.spec.ts` pins the route itself.
 */
export const artifactHref = (
  projectSlug: string | undefined,
  build: { app: string; tag: string; variant?: string },
): `/${string}` =>
  `/${projectSlug}/artifacts/${build.app}/${build.tag}${
    build.variant ? `?variant=${build.variant}` : ""
  }`;

export const artifactCopyState = (
  copy: ArtifactCopy,
  variant: ArtifactResource,
  runs: ArtifactRun[],
): ArtifactCopyState => {
  if (copy.deployed?.sha256 === variant.sha256) {
    return "running";
  }
  const ran = runs.some(
    (run) =>
      run.instanceId === copy.id &&
      run.sha256 === variant.sha256 &&
      run.status === "succeeded",
  );
  return ran ? "superseded" : "other";
};

/**
 * The app's builds of this variant's runtime and format, newest first, each
 * with its size against the one before it.
 *
 * ⚠️ Same runtime and format, or the delta compares a tarball to an image. A
 * tag with no such variant is left out rather than shown with a wrong size.
 */
export const artifactBuildRows = (
  groups: ArtifactGroup[],
  variant: ArtifactResource,
): ArtifactBuildRow[] => {
  const builds = groups
    .flatMap((group) => {
      const match = group.variants.find(
        (it) => it.runtime === variant.runtime && it.format === variant.format,
      );
      return match ? [{ tag: group.tag, variant: match }] : [];
    })
    .sort((a, b) => b.variant.updatedAt.localeCompare(a.variant.updatedAt));

  return builds.map((build, index) => {
    const { variant: mine } = build;
    const older = builds[index + 1]?.variant;
    return {
      tag: build.tag,
      size: mine.size,
      pushedAt: mine.updatedAt,
      commitSha: mine.commitSha,
      declares: mine.declares,
      ...(mine.size === undefined || older?.size === undefined
        ? {}
        : { delta: mine.size - older.size }),
      ...(mine.declares && older?.declares
        ? {
            changes: {
              variables: nameChange(
                mine.declares.variables,
                older.declares.variables,
              ),
              secrets: nameChange(
                mine.declares.secrets,
                older.declares.secrets,
              ),
              resources: nameChange(
                mine.declares.resources,
                older.declares.resources,
              ),
              crons: nameChange(mine.declares.crons, older.declares.crons),
              ...(mine.runtimes.join() === older.runtimes.join()
                ? {}
                : { runtimes: mine.runtimes }),
            },
          }
        : {}),
    };
  });
};

const nameChange = (mine: string[], older: string[]): ArtifactNameChange => ({
  added: mine.filter((it) => !older.includes(it)),
  removed: older.filter((it) => !mine.includes(it)),
});

/**
 * A count's move from the older build, signed: `+2`, `-1`, and nothing when
 * as many came as went.
 */
export const artifactSignedCount = (change: ArtifactNameChange): string => {
  const net = change.added.length - change.removed.length;
  return net === 0 ? "" : net > 0 ? `+${net}` : `${net}`;
};

/**
 * The names behind a change, for a tooltip: `+A, +B, -C`.
 */
export const artifactChangeNames = (change: ArtifactNameChange): string =>
  [
    ...change.added.map((it) => `+${it}`),
    ...change.removed.map((it) => `-${it}`),
  ].join(", ");

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((it) => typeof it === "string") : [];

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((it) => (typeof it?.name === "string" ? [it.name] : []))
    : [];

export const artifactManifestSummary = (
  manifest: Record<string, any>,
): ArtifactManifestSummary => ({
  slices: Array.isArray(manifest.runtimes)
    ? manifest.runtimes.flatMap((slice) =>
        typeof slice?.runtime === "string"
          ? [
              {
                runtime: slice.runtime,
                entry: slice.entry,
                version: slice.runtimeVersion,
              },
            ]
          : [],
      )
    : [],
  resources: Object.entries(manifest.resources ?? {}).flatMap(([key, value]) =>
    typeof value === "boolean"
      ? [{ name: artifactResourceName(key), on: value }]
      : [],
  ),
  crons: strings(manifest.crons),
  secrets: names(manifest.secrets),
  variables: names(manifest.variables),
  websocketPaths: strings(manifest.cloudflare?.websocketPaths),
});

/**
 * The platforms of an OCI index, skipping the attestation entries buildx adds,
 * which name `unknown/unknown` and are not something anyone can pull.
 */
export const artifactImagePlatforms = (
  manifest: Record<string, any>,
): ArtifactImagePlatform[] =>
  Array.isArray(manifest.manifests)
    ? manifest.manifests.flatMap((entry) => {
        const { os, architecture } = entry?.platform ?? {};
        return typeof os === "string" &&
          typeof architecture === "string" &&
          os !== "unknown"
          ? [{ platform: `${os}/${architecture}`, digest: entry.digest }]
          : [];
      })
    : [];
