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
): string =>
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
  const rows = groups
    .flatMap((group) => {
      const match = group.variants.find(
        (it) => it.runtime === variant.runtime && it.format === variant.format,
      );
      return match
        ? [{ tag: group.tag, size: match.size, pushedAt: match.updatedAt }]
        : [];
    })
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));

  return rows.map((row, index) => {
    const older = rows[index + 1]?.size;
    return row.size === undefined || older === undefined
      ? row
      : { ...row, delta: row.size - older };
  });
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((it) => typeof it === "string") : [];

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((it) => (typeof it?.name === "string" ? [it.name] : []))
    : [];

/**
 * `hasDatabase` reads `database`, `hasKV` reads `kv`: the document's own keys
 * rather than a list here, so a resource a newer build declares still shows.
 */
const resourceName = (key: string): string =>
  key
    .replace(/^has/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

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
    typeof value === "boolean" ? [{ name: resourceName(key), on: value }] : [],
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
