import {
  type ArtifactManifestSlice,
  artifactManifestSummary,
} from "./artifactView.ts";

export interface ArtifactManifestNamed {
  name: string;
  description?: string;
}

/**
 * `dist/manifest.json` cut into what the Manifest tab draws, and what it
 * does not.
 *
 * ⚠️ `other` is the rule this exists for: NOTHING the document carries is
 * dropped. The manifest is `.loose()` at every level and written by a build
 * of any age, so a newer build may declare a key, or a field of a known key,
 * that this Lore has never heard of. Whatever the sections above did not
 * draw lands in `other`, under the key it came from, and is shown raw.
 */
export interface ArtifactManifestParts {
  /**
   * The scalars about the build itself: project, manifest version, ...
   */
  build: Array<{ name: string; value: string }>;
  runtimes: ArtifactManifestSlice[];
  resources: Array<{ name: string; on: boolean }>;
  crons: string[];
  secrets: ArtifactManifestNamed[];
  variables: ArtifactManifestNamed[];
  websocketPaths: string[];
  /**
   * The rest of the `cloudflare` group, raw: the generated config, the
   * durable objects, the bindings.
   */
  cloudflare?: Record<string, unknown>;
  other?: Record<string, unknown>;
}

type Loose = Record<string, any>;

const BUILD_KEYS = ["project", "manifestVersion", "inspect", "optionsHash"];

const isObject = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const without = (value: Loose, keys: string[]): Loose | undefined => {
  const rest = Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
  return Object.keys(rest).length ? rest : undefined;
};

/**
 * What a list's entries carry beyond the fields drawn, entry by entry, or
 * `undefined` when every entry was drawn whole. An entry of another shape
 * altogether is kept as it is.
 */
const leftovers = (
  list: unknown,
  drawn: string[],
  usable: (entry: Loose) => boolean,
): unknown[] | undefined => {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) return [list];
  const rest = list.flatMap((entry) => {
    if (!isObject(entry) || !usable(entry)) return [entry];
    const extra = without(entry, drawn);
    // Named, so a leftover field can be traced back to its entry.
    return extra ? [{ ...extra, [drawn[0]]: entry[drawn[0]] }] : [];
  });
  return rest.length ? rest : undefined;
};

const named = (value: unknown): ArtifactManifestNamed[] =>
  Array.isArray(value)
    ? value.flatMap((it) =>
        typeof it?.name === "string"
          ? [
              {
                name: it.name,
                description:
                  typeof it.description === "string"
                    ? it.description
                    : undefined,
              },
            ]
          : [],
      )
    : [];

export const artifactManifestParts = (
  manifest: Loose,
): ArtifactManifestParts => {
  const summary = artifactManifestSummary(manifest);
  const other: Loose =
    without(manifest, [
      ...BUILD_KEYS,
      "runtimes",
      "resources",
      "crons",
      "secrets",
      "variables",
      "cloudflare",
    ]) ?? {};

  const scalar = (value: unknown) =>
    ["string", "number", "boolean"].includes(typeof value);
  const build = BUILD_KEYS.flatMap((name) => {
    if (manifest[name] === undefined) return [];
    if (scalar(manifest[name])) {
      return [{ name, value: String(manifest[name]) }];
    }
    other[name] = manifest[name];
    return [];
  });

  const keep = (key: string, rest: unknown) => {
    if (rest !== undefined) other[key] = rest;
  };
  keep(
    "runtimes",
    leftovers(
      manifest.runtimes,
      ["runtime", "entry", "runtimeVersion"],
      (entry) => typeof entry.runtime === "string",
    ),
  );
  keep(
    "secrets",
    leftovers(
      manifest.secrets,
      ["name", "description"],
      (entry) => typeof entry.name === "string",
    ),
  );
  keep(
    "variables",
    leftovers(
      manifest.variables,
      ["name", "description"],
      (entry) => typeof entry.name === "string",
    ),
  );
  if (manifest.resources !== undefined) {
    keep(
      "resources",
      isObject(manifest.resources)
        ? without(
            manifest.resources,
            Object.keys(manifest.resources).filter(
              (key) => typeof manifest.resources[key] === "boolean",
            ),
          )
        : manifest.resources,
    );
  }
  if (manifest.crons !== undefined) {
    const odd = Array.isArray(manifest.crons)
      ? manifest.crons.filter((it: unknown) => typeof it !== "string")
      : [manifest.crons];
    keep("crons", odd.length ? odd : undefined);
  }

  let cloudflare: Loose | undefined;
  if (isObject(manifest.cloudflare)) {
    cloudflare = without(
      manifest.cloudflare,
      summary.websocketPaths.length ? ["websocketPaths"] : [],
    );
  } else {
    keep("cloudflare", manifest.cloudflare);
  }

  return {
    build,
    runtimes: summary.slices,
    resources: summary.resources,
    crons: summary.crons,
    secrets: named(manifest.secrets),
    variables: named(manifest.variables),
    websocketPaths: summary.websocketPaths,
    cloudflare,
    other: Object.keys(other).length ? other : undefined,
  };
};
